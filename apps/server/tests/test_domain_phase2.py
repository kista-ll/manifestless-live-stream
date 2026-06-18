from pathlib import Path

import pytest

from manifestless_server.domain import (
    FfmpegProcessSpec,
    IngestManager,
    IngestState,
    Metrics,
    Segment,
    SegmentRingBuffer,
    SegmentWatcher,
    StreamState,
    ViewerRegistry,
    ViewerState,
    parse_segment_sequence,
)


def make_segment(sequence: int) -> Segment:
    return Segment(
        sequence=sequence,
        path=Path(f"segment-{sequence:06d}.m4s"),
        payload=f"segment-{sequence}".encode(),
        pts_ms=(sequence - 1) * 1000,
    )


def test_ring_buffer_keeps_latest_30_segments() -> None:
    metrics = Metrics()
    ring = SegmentRingBuffer(capacity=30, metrics=metrics)

    for sequence in range(1, 32):
        ring.add(make_segment(sequence))

    assert ring.segment_count == 30
    assert ring.oldest_sequence == 2
    assert ring.latest_sequence == 31
    assert metrics.segments_registered_total == 31
    assert metrics.segments_dropped_total == 1


def test_start_sequence_uses_latest_minus_two_but_not_before_oldest() -> None:
    ring = SegmentRingBuffer(capacity=30)
    ring.add(make_segment(10))
    ring.add(make_segment(11))

    assert ring.start_sequence_for_join() == 10

    ring.add(make_segment(12))
    ring.add(make_segment(13))

    assert ring.start_sequence_for_join() == 11


def test_sequence_gap_is_recorded() -> None:
    metrics = Metrics()
    ring = SegmentRingBuffer(metrics=metrics)

    ring.add(make_segment(1))
    ring.add(make_segment(3))

    assert ring.last_gap == (1, 3)
    assert metrics.sequence_gaps_total == 1


def test_viewer_registry_rejects_eleventh_viewer() -> None:
    metrics = Metrics()
    registry = ViewerRegistry(limit=10, metrics=metrics)

    for index in range(10):
        assert registry.add(f"viewer-{index}") is not None

    assert registry.add("viewer-10") is None
    assert registry.count == 10
    assert metrics.viewer_connections_total == 10
    assert metrics.viewer_rejected_total == 1


def test_viewer_queue_drops_old_segments_for_slow_viewer() -> None:
    registry = ViewerRegistry(limit=1)
    session = registry.add("viewer-1")
    assert session is not None

    for sequence in range(1, 8):
        session.enqueue(make_segment(sequence))

    assert [segment.sequence for segment in session.queue] == [3, 4, 5, 6, 7]
    assert session.dropped_segments == 2
    assert session.requires_discontinuity is True
    assert session.state is ViewerState.SLOW


def test_ingest_reconnect_clears_ring_buffer_and_viewers() -> None:
    ring = SegmentRingBuffer()
    viewers = ViewerRegistry()
    manager = IngestManager(ring_buffer=ring, viewers=viewers)
    spec = FfmpegProcessSpec(executable="ffmpeg", arguments=("-version",))

    manager.start_listener(spec)
    manager.mark_connected()
    ring.add(make_segment(1))
    assert viewers.add("viewer-1") is not None
    manager.mark_live()
    manager.mark_interrupted()
    manager.restart_listener()

    assert manager.ingest_state is IngestState.LISTENING
    assert manager.stream_state is StreamState.WAITING_FOR_INGEST
    assert ring.segment_count == 0
    assert viewers.count == 0
    assert "ingest_restarting" in manager.events


def test_parse_segment_sequence_accepts_only_specified_name() -> None:
    assert parse_segment_sequence(Path("segment-000123.m4s")) == 123
    assert parse_segment_sequence(Path("segment-123.m4s")) is None
    assert parse_segment_sequence(Path("playlist.m3u8")) is None


def test_segment_watcher_registers_new_segments(tmp_path: Path) -> None:
    media_dir = tmp_path
    (media_dir / "segment-000001.m4s").write_bytes(b"first")
    (media_dir / "ignored.tmp").write_bytes(b"ignored")
    ring = SegmentRingBuffer()
    watcher = SegmentWatcher(media_dir=media_dir, ring_buffer=ring)

    registered = watcher.scan_once()
    second_scan = watcher.scan_once()

    assert [segment.sequence for segment in registered] == [1]
    assert second_scan == []
    assert ring.latest_sequence == 1


def test_segment_rejects_empty_payload() -> None:
    with pytest.raises(ValueError, match="payload"):
        Segment(sequence=1, path=Path("segment-000001.m4s"), payload=b"", pts_ms=0)
