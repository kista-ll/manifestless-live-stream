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
    NdjsonDecoder,
    ProtocolError,
    capacity_exceeded,
    encode_binary_frame,
    encode_control_message,
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


class AioquicWebTransportSession:
    def __init__(
        self,
        *,
        session_id: str,
        protocol: AioquicWebTransportProtocol,
        webtransport_session_id: int,
        control_stream_id: int,
    ) -> None:
        self.session_id = session_id
        self._protocol = protocol
        self._webtransport_session_id = webtransport_session_id
        self._control_stream_id = control_stream_id

    async def send_control(self, message: dict[str, object]) -> None:
        self._protocol.send_stream_data(
            self._control_stream_id,
            encode_control_message(message),
            end_stream=False,
        )

    async def send_binary(self, data: bytes) -> None:
        stream_id = self._protocol.create_uni_stream(self._webtransport_session_id)
        self._protocol.send_stream_data(stream_id, data, end_stream=True)

    async def close(self, code: ApplicationCloseCode) -> None:
        self._protocol.close_session(int(code))


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
            await asyncio.sleep(2)
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

    def update_init_segment(self, init_segment: bytes | None) -> None:
        self._init_segment = init_segment

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
        stream_service: WebTransportStreamService | None = None,
        path: str = "/webtransport/live-001",
    ) -> None:
        super().__init__(quic, stream_handler=stream_handler)
        self._http: H3Connection | None = None
        self._stream_service = stream_service
        self._path = path
        self._accepted_sessions: set[int] = set()
        self._control_decoders: dict[int, NdjsonDecoder] = {}

    def quic_event_received(self, event: QuicEvent) -> None:
        if self._http is None:
            self._http = H3Connection(self._quic, enable_webtransport=True)
        for http_event in self._http.handle_event(event):
            self._handle_h3_event(http_event)
        self.transmit()

    def _handle_h3_event(self, event: H3Event) -> None:
        if isinstance(event, HeadersReceived):
            self._handle_headers(event)
        elif isinstance(event, WebTransportStreamDataReceived):
            self._handle_webtransport_stream_data(event)
            LOGGER.info(
                "webtransport_stream_data_received",
                extra={"stream_id": event.stream_id, "session_id": event.session_id},
            )

    def _handle_headers(self, event: HeadersReceived) -> None:
        headers = dict(event.headers)
        method = headers.get(b":method")
        protocol = headers.get(b":protocol")
        path = headers.get(b":path", b"").decode("ascii", errors="ignore")
        if self._http is None:
            return
        if method == b"CONNECT" and protocol == b"webtransport" and path == self._path:
            self._accepted_sessions.add(event.stream_id)
            self._http.send_headers(
                stream_id=event.stream_id,
                headers=[
                    (b":status", b"200"),
                    (b"server", b"manifestless-live-stream"),
                    (b"sec-webtransport-http3-draft", b"draft02"),
                ],
                end_stream=False,
            )
            LOGGER.info("webtransport_session_accepted", extra={"session_id": event.stream_id})
        else:
            self._http.send_headers(
                stream_id=event.stream_id,
                headers=[(b":status", b"404")],
                end_stream=True,
            )

    def _handle_webtransport_stream_data(self, event: WebTransportStreamDataReceived) -> None:
        if self._stream_service is None or event.session_id not in self._accepted_sessions:
            return
        decoder = self._control_decoders.setdefault(event.stream_id, NdjsonDecoder())
        for message in decoder.feed(event.data):
            session_id = str(message.get("clientId", f"viewer-{event.session_id}"))
            session = AioquicWebTransportSession(
                session_id=session_id,
                protocol=self,
                webtransport_session_id=event.session_id,
                control_stream_id=event.stream_id,
            )
            asyncio.create_task(self._stream_service.connect(session, message))

    def create_uni_stream(self, session_id: int) -> int:
        if self._http is None:
            raise RuntimeError("HTTP/3 connection is not initialized")
        return self._http.create_webtransport_stream(session_id, is_unidirectional=True)

    def send_stream_data(self, stream_id: int, data: bytes, *, end_stream: bool) -> None:
        self._quic.send_stream_data(stream_id=stream_id, data=data, end_stream=end_stream)
        self.transmit()

    def close_session(self, error_code: int) -> None:
        self._quic.close(error_code=error_code)
        self.transmit()


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
    stream_service: WebTransportStreamService | None = None,
) -> None:
    configuration = create_quic_configuration(cert_path, key_path)
    server = await serve(
        host,
        port,
        configuration=configuration,
        create_protocol=lambda quic, stream_handler=None: AioquicWebTransportProtocol(
            quic,
            stream_handler=stream_handler,
            stream_service=stream_service,
        ),
    )
    try:
        await asyncio.Future()
    finally:
        server.close()
