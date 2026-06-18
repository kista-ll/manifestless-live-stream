from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from manifestless_server.domain.models import IngestState, StreamState
from manifestless_server.domain.ring_buffer import SegmentRingBuffer
from manifestless_server.domain.viewer import ViewerRegistry


@dataclass(frozen=True, slots=True)
class FfmpegProcessSpec:
    executable: str
    arguments: tuple[str, ...]

    def command(self) -> tuple[str, ...]:
        return (self.executable, *self.arguments)


@dataclass(slots=True)
class IngestManager:
    ring_buffer: SegmentRingBuffer
    viewers: ViewerRegistry
    ingest_state: IngestState = IngestState.STOPPED
    stream_state: StreamState = StreamState.IDLE
    ingest_session_id: int = 0
    connected_at: datetime | None = None
    last_error: str | None = None
    ffmpeg_spec: FfmpegProcessSpec | None = None
    events: list[str] = field(default_factory=list)

    def start_listener(self, spec: FfmpegProcessSpec) -> None:
        self.ffmpeg_spec = spec
        self.ingest_state = IngestState.LISTENING
        self.stream_state = StreamState.WAITING_FOR_INGEST
        self.events.append("ingest_listener_started")

    def mark_connected(self) -> None:
        if self.ingest_state is not IngestState.LISTENING:
            raise RuntimeError("ingest can connect only from LISTENING")
        self.ingest_state = IngestState.CONNECTED
        self.stream_state = StreamState.STARTING
        self.ingest_session_id += 1
        self.connected_at = datetime.now(UTC)
        self.events.append("ingest_connected")

    def mark_live(self) -> None:
        if self.ingest_state is not IngestState.CONNECTED:
            raise RuntimeError("stream can become LIVE only while ingest is CONNECTED")
        self.stream_state = StreamState.LIVE
        self.events.append("ingest_segmenting_started")

    def mark_interrupted(self) -> None:
        self.ingest_state = IngestState.INTERRUPTED
        self.stream_state = StreamState.INTERRUPTED
        self.events.append("ingest_disconnected")

    def restart_listener(self) -> None:
        self.ring_buffer.clear()
        self.viewers.clear()
        self.connected_at = None
        self.ingest_state = IngestState.LISTENING
        self.stream_state = StreamState.WAITING_FOR_INGEST
        self.events.append("ingest_restarting")

    def mark_error(self, message: str) -> None:
        self.last_error = message
        self.ingest_state = IngestState.ERROR
        self.stream_state = StreamState.ERROR
        self.events.append("ingest_error")
