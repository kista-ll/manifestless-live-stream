from pathlib import Path

from fastapi.testclient import TestClient

from manifestless_server.app import create_app, create_default_state
from manifestless_server.domain import Segment


def make_segment(sequence: int) -> Segment:
    return Segment(
        sequence=sequence,
        path=Path(f"segment-{sequence:06d}.m4s"),
        payload=b"payload",
        pts_ms=(sequence - 1) * 1000,
    )


def test_health_contract() -> None:
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_stream_contract(tmp_path: Path) -> None:
    media_dir = tmp_path
    (media_dir / "init.mp4").write_bytes(b"init")
    state = create_default_state(media_dir=media_dir)
    state.ring_buffer.add(make_segment(1))
    state.ring_buffer.add(make_segment(2))
    state.viewers.add("viewer-1")
    client = TestClient(create_app(state))

    payload = client.get("/api/stream").json()

    assert payload["streamId"] == "live-001"
    assert payload["viewerCount"] == 1
    assert payload["viewerLimit"] == 10
    assert payload["initAvailable"] is True
    assert payload["oldestSequence"] == 1
    assert payload["latestSequence"] == 2
    assert payload["segmentCount"] == 2
    assert payload["ingest"]["protocol"] == "srt"


def test_stream_end_and_reset_contract() -> None:
    state = create_default_state()
    assert state.viewers.add("viewer-1") is not None
    state.ring_buffer.add(make_segment(1))
    client = TestClient(create_app(state))

    end_response = client.post("/api/stream/end")
    reset_response = client.post("/api/stream/reset")

    assert end_response.status_code == 202
    assert end_response.json() == {"accepted": True}
    assert reset_response.status_code == 202
    assert reset_response.json() == {"accepted": True}
    assert state.viewers.count == 0
    assert state.ring_buffer.segment_count == 0


def test_metrics_contract() -> None:
    state = create_default_state()
    state.metrics.viewer_connections_total = 4
    state.metrics.bytes_sent_total = 1024
    client = TestClient(create_app(state))

    payload = client.get("/api/metrics").json()

    assert payload["viewerConnectionsTotal"] == 4
    assert payload["bytesSentTotal"] == 1024


def test_ingest_contract() -> None:
    client = TestClient(create_app())

    payload = client.get("/api/ingest").json()

    assert payload["protocol"] == "srt"
    assert payload["mode"] == "listener"
    assert payload["listenAddress"] == "0.0.0.0"
    assert payload["listenPort"] == 9000
    assert payload["state"] == "STOPPED"
