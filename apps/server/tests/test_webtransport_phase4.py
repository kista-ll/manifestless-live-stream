from pathlib import Path

import pytest

from manifestless_server.domain import Metrics, Segment, SegmentRingBuffer, ViewerRegistry
from manifestless_server.protocol import (
    ApplicationCloseCode,
    BinaryFrameType,
    client_hello,
    decode_binary_frame,
)
from manifestless_server.transport import InMemoryWebTransportSession, WebTransportStreamService


def make_segment(sequence: int) -> Segment:
    return Segment(
        sequence=sequence,
        path=Path(f"segment-{sequence:06d}.m4s"),
        payload=f"payload-{sequence}".encode(),
        pts_ms=(sequence - 1) * 1000,
    )


@pytest.mark.asyncio
async def test_connect_sends_stream_init_init_and_backlog_then_live_segments() -> None:
    metrics = Metrics()
    ring = SegmentRingBuffer(metrics=metrics)
    viewers = ViewerRegistry(metrics=metrics)
    for sequence in range(1, 4):
        ring.add(make_segment(sequence))
    service = WebTransportStreamService(
        ring_buffer=ring,
        viewers=viewers,
        init_segment=b"init",
        metrics=metrics,
    )
    session = InMemoryWebTransportSession(session_id="viewer-1")

    viewer = await service.connect(session, client_hello("client-1"))
    await service.push_segment(make_segment(4))
    await service.push_segment(make_segment(5))

    assert viewer is not None
    assert session.control_messages[0]["type"] == "stream_init"
    assert session.control_messages[0]["latestSequence"] == 3
    assert session.control_messages[0]["startSequence"] == 1
    frames = [decode_binary_frame(stream) for stream in session.binary_streams]
    assert frames[0].frame_type is BinaryFrameType.INIT
    assert [frame.sequence for frame in frames[1:]] == [1, 2, 3, 4, 5]
    assert metrics.bytes_sent_total > 0


@pytest.mark.asyncio
async def test_eleventh_viewer_is_rejected_with_capacity_exceeded() -> None:
    ring = SegmentRingBuffer()
    ring.add(make_segment(1))
    viewers = ViewerRegistry(limit=10)
    service = WebTransportStreamService(
        ring_buffer=ring,
        viewers=viewers,
        init_segment=b"init",
    )

    for index in range(10):
        session = InMemoryWebTransportSession(session_id=f"viewer-{index}")
        assert await service.connect(session, client_hello(f"client-{index}")) is not None

    rejected = InMemoryWebTransportSession(session_id="viewer-10")

    assert await service.connect(rejected, client_hello("client-10")) is None
    assert rejected.control_messages == [{"type": "capacity_exceeded", "limit": 10}]
    assert rejected.close_code is ApplicationCloseCode.CAPACITY_EXCEEDED
    assert viewers.count == 10


@pytest.mark.asyncio
async def test_viewer_is_rejected_when_stream_is_not_ready() -> None:
    ring = SegmentRingBuffer()
    viewers = ViewerRegistry()
    service = WebTransportStreamService(
        ring_buffer=ring,
        viewers=viewers,
        init_segment=None,
    )
    session = InMemoryWebTransportSession(session_id="viewer-1")

    assert await service.connect(session, client_hello("client-1")) is None
    assert session.close_code is ApplicationCloseCode.STREAM_NOT_READY
    assert viewers.count == 0


@pytest.mark.asyncio
async def test_stream_end_sends_control_and_closes_sessions() -> None:
    ring = SegmentRingBuffer()
    ring.add(make_segment(1))
    viewers = ViewerRegistry()
    service = WebTransportStreamService(
        ring_buffer=ring,
        viewers=viewers,
        init_segment=b"init",
    )
    session = InMemoryWebTransportSession(session_id="viewer-1")
    await service.connect(session, client_hello("client-1"))

    await service.end_stream()

    assert session.control_messages[-1] == {"type": "stream_ended", "lastSequence": 1}
    assert session.close_code is ApplicationCloseCode.NORMAL_END
    assert viewers.count == 0
