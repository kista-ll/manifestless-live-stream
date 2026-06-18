from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI

from manifestless_server.domain import IngestManager, IngestState, Metrics, SegmentRingBuffer
from manifestless_server.domain.models import StreamState
from manifestless_server.domain.viewer import ViewerRegistry

STREAM_ID = "live-001"


@dataclass(slots=True)
class AppState:
    ring_buffer: SegmentRingBuffer
    viewers: ViewerRegistry
    ingest: IngestManager
    metrics: Metrics
    media_dir: Path


def create_default_state(media_dir: Path | None = None) -> AppState:
    metrics = Metrics()
    ring = SegmentRingBuffer(capacity=30, metrics=metrics)
    viewers = ViewerRegistry(limit=10, metrics=metrics)
    ingest = IngestManager(ring_buffer=ring, viewers=viewers)
    return AppState(
        ring_buffer=ring,
        viewers=viewers,
        ingest=ingest,
        metrics=metrics,
        media_dir=media_dir or Path("media/live"),
    )


def create_app(state: AppState | None = None) -> FastAPI:
    app_state = state or create_default_state()
    app = FastAPI(title="Manifestless Live Stream")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/stream")
    def stream() -> dict[str, object]:
        return {
            "streamId": STREAM_ID,
            "state": app_state.ingest.stream_state.value,
            "viewerCount": app_state.viewers.count,
            "viewerLimit": app_state.viewers.limit,
            "initAvailable": (app_state.media_dir / "init.mp4").exists(),
            "oldestSequence": app_state.ring_buffer.oldest_sequence,
            "latestSequence": app_state.ring_buffer.latest_sequence,
            "segmentCount": app_state.ring_buffer.segment_count,
            "ingest": ingest_payload(app_state.ingest),
        }

    @app.post("/api/stream/end", status_code=202)
    def stream_end() -> dict[str, bool]:
        app_state.ingest.stream_state = StreamState.ENDING
        app_state.viewers.clear()
        app_state.ingest.stream_state = StreamState.ENDED
        return {"accepted": True}

    @app.post("/api/stream/reset", status_code=202)
    def stream_reset() -> dict[str, bool]:
        app_state.ring_buffer.clear()
        app_state.viewers.clear()
        app_state.ingest.ingest_state = IngestState.STOPPED
        app_state.ingest.stream_state = StreamState.IDLE
        app_state.ingest.last_error = None
        return {"accepted": True}

    @app.get("/api/metrics")
    def metrics() -> dict[str, int]:
        return app_state.metrics.as_dict()

    @app.get("/api/ingest")
    def ingest() -> dict[str, object]:
        payload = ingest_payload(app_state.ingest)
        payload.update(
            {
                "mode": "listener",
                "listenAddress": "0.0.0.0",
                "listenPort": 9000,
            }
        )
        return payload

    return app


def ingest_payload(ingest: IngestManager) -> dict[str, object]:
    return {
        "protocol": "srt",
        "state": ingest.ingest_state.value,
        "remoteAddress": None,
        "videoCodec": None,
        "audioCodec": None,
        "connectedAt": ingest.connected_at.isoformat() if ingest.connected_at else None,
        "lastError": ingest.last_error,
    }


app = create_app()
