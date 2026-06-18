from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from aioquic.asyncio.protocol import QuicConnectionProtocol
from aioquic.asyncio.server import serve
from aioquic.h3.connection import H3Connection
from aioquic.h3.events import H3Event, HeadersReceived, WebTransportStreamDataReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.connection import QuicConnection
from aioquic.quic.events import QuicEvent

from manifestless_server.domain.metrics import Metrics
from manifestless_server.domain.models import Segment
from manifestless_server.domain.ring_buffer import SegmentRingBuffer
from manifestless_server.domain.viewer import ViewerRegistry, ViewerSession
from manifestless_server.protocol import (
    ApplicationCloseCode,
    BinaryFrame,
    BinaryFrameType,
    ProtocolError,
    capacity_exceeded,
    encode_binary_frame,
    stream_ended,
    stream_init,
    validate_client_hello,
)

LOGGER = logging.getLogger("manifestless_server.webtransport")


class WebTransportSession(Protocol):
    session_id: str

    async def send_control(self, message: dict[str, object]) -> None:
        ...

    async def send_binary(self, data: bytes) -> None:
        ...

    async def close(self, code: ApplicationCloseCode) -> None:
        ...


@dataclass(slots=True)
class InMemoryWebTransportSession:
    session_id: str
    control_messages: list[dict[str, object]] = field(default_factory=list)
    binary_streams: list[bytes] = field(default_factory=list)
    close_code: ApplicationCloseCode | None = None

    async def send_control(self, message: dict[str, object]) -> None:
        self.control_messages.append(message)

    async def send_binary(self, data: bytes) -> None:
        self.binary_streams.append(data)

    async def close(self, code: ApplicationCloseCode) -> None:
        self.close_code = code


class WebTransportStreamService:
    def __init__(
        self,
        *,
        ring_buffer: SegmentRingBuffer,
        viewers: ViewerRegistry,
        init_segment: bytes | None,
        metrics: Metrics | None = None,
    ) -> None:
        self._ring_buffer = ring_buffer
        self._viewers = viewers
        self._init_segment = init_segment
        self._metrics = metrics
        self._sessions: dict[str, WebTransportSession] = {}

    async def connect(
        self,
        session: WebTransportSession,
        client_message: dict[str, object],
    ) -> ViewerSession | None:
        try:
            validate_client_hello(client_message)
        except ProtocolError:
            await session.close(ApplicationCloseCode.INVALID_CLIENT_MESSAGE)
            raise

        viewer = self._viewers.add(session.session_id)
        if viewer is None:
            await session.send_control(capacity_exceeded(self._viewers.limit))
            await session.close(ApplicationCloseCode.CAPACITY_EXCEEDED)
            LOGGER.info(
                "viewer_rejected",
                extra={"session_id": session.session_id, "viewer_count": self._viewers.count},
            )
            return None

        if self._init_segment is None:
            self._viewers.remove(session.session_id)
            await session.close(ApplicationCloseCode.STREAM_NOT_READY)
            raise ProtocolError("init segment is not available")

        self._sessions[session.session_id] = session
        start_sequence = self._ring_buffer.start_sequence_for_join()
        latest_sequence = self._ring_buffer.latest_sequence
        if start_sequence is None or latest_sequence is None:
            start_sequence = 0
            latest_sequence = 0

        await session.send_control(stream_init(latest_sequence, start_sequence))
        await session.send_binary(
            encode_binary_frame(
                BinaryFrame(
                    frame_type=BinaryFrameType.INIT,
                    sequence=0,
                    pts_ms=0,
                    duration_ms=0,
                    payload=self._init_segment,
                )
            )
        )

        for segment in self._ring_buffer.list_from(start_sequence):
            await self._send_segment(session, segment)

        LOGGER.info(
            "viewer_connected",
            extra={"session_id": session.session_id, "viewer_count": self._viewers.count},
        )
        return viewer

    async def push_segment(self, segment: Segment) -> None:
        self._viewers.broadcast(segment)
        for session in list(self._sessions.values()):
            await self._send_segment(session, segment)

    async def end_stream(self) -> None:
        latest = self._ring_buffer.latest_sequence or 0
        for session_id, session in list(self._sessions.items()):
            await session.send_control(stream_ended(latest))
            await session.close(ApplicationCloseCode.NORMAL_END)
            self.disconnect(session_id)

    def disconnect(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        self._viewers.remove(session_id)

    async def _send_segment(self, session: WebTransportSession, segment: Segment) -> None:
        payload = encode_binary_frame(
            BinaryFrame(
                frame_type=BinaryFrameType.MEDIA,
                sequence=segment.sequence,
                pts_ms=segment.pts_ms,
                duration_ms=segment.duration_ms,
                payload=segment.payload,
                independent=segment.independent,
            )
        )
        await session.send_binary(payload)
        if self._metrics is not None:
            self._metrics.bytes_sent_total += len(payload)
        LOGGER.info(
            "segment_sent",
            extra={"session_id": session.session_id, "sequence": segment.sequence},
        )


class AioquicWebTransportProtocol(QuicConnectionProtocol):
    def __init__(
        self,
        quic: QuicConnection,
        stream_handler: Callable[[asyncio.StreamReader, asyncio.StreamWriter], None] | None = None,
    ) -> None:
        super().__init__(quic, stream_handler=stream_handler)
        self._http: H3Connection | None = None

    def quic_event_received(self, event: QuicEvent) -> None:
        if self._http is None:
            self._http = H3Connection(self._quic, enable_webtransport=True)
        for http_event in self._http.handle_event(event):
            self._handle_h3_event(http_event)
        self.transmit()

    def _handle_h3_event(self, event: H3Event) -> None:
        if isinstance(event, HeadersReceived):
            LOGGER.info("webtransport_headers_received", extra={"stream_id": event.stream_id})
        elif isinstance(event, WebTransportStreamDataReceived):
            LOGGER.info(
                "webtransport_stream_data_received",
                extra={"stream_id": event.stream_id, "session_id": event.session_id},
            )


def create_quic_configuration(cert_path: Path, key_path: Path) -> QuicConfiguration:
    configuration = QuicConfiguration(
        alpn_protocols=["h3"],
        is_client=False,
        max_datagram_frame_size=None,
    )
    configuration.load_cert_chain(str(cert_path), str(key_path))
    return configuration


async def run_webtransport_server(
    *,
    host: str,
    port: int,
    cert_path: Path,
    key_path: Path,
) -> None:
    configuration = create_quic_configuration(cert_path, key_path)
    server = await serve(
        host,
        port,
        configuration=configuration,
        create_protocol=AioquicWebTransportProtocol,
    )
    try:
        await asyncio.Future()
    finally:
        server.close()
