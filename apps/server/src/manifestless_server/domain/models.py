from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class StreamState(StrEnum):
    IDLE = "IDLE"
    WAITING_FOR_INGEST = "WAITING_FOR_INGEST"
    STARTING = "STARTING"
    LIVE = "LIVE"
    INTERRUPTED = "INTERRUPTED"
    ENDING = "ENDING"
    ENDED = "ENDED"
    ERROR = "ERROR"


class IngestState(StrEnum):
    STOPPED = "STOPPED"
    LISTENING = "LISTENING"
    CONNECTED = "CONNECTED"
    INTERRUPTED = "INTERRUPTED"
    ERROR = "ERROR"


class ViewerState(StrEnum):
    CONNECTING = "CONNECTING"
    INITIALIZING = "INITIALIZING"
    STREAMING = "STREAMING"
    SLOW = "SLOW"
    CLOSING = "CLOSING"
    CLOSED = "CLOSED"


@dataclass(frozen=True, slots=True)
class Segment:
    sequence: int
    path: Path
    payload: bytes
    pts_ms: int
    duration_ms: int = 1000
    independent: bool = True

    def __post_init__(self) -> None:
        if self.sequence < 1:
            raise ValueError("media segment sequence must be 1 or greater")
        if self.duration_ms <= 0:
            raise ValueError("media segment duration must be positive")
        if not self.payload:
            raise ValueError("media segment payload must not be empty")
