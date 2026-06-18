from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from manifestless_server.domain.metrics import Metrics
from manifestless_server.domain.models import Segment, ViewerState


@dataclass(slots=True)
class ViewerSession:
    session_id: str
    queue_limit: int = 5
    state: ViewerState = ViewerState.CONNECTING
    queue: deque[Segment] = field(default_factory=deque)
    dropped_segments: int = 0
    requires_discontinuity: bool = False

    def enqueue(self, segment: Segment) -> None:
        self.queue.append(segment)
        while len(self.queue) > self.queue_limit:
            self.queue.popleft()
            self.dropped_segments += 1
            self.requires_discontinuity = True
            self.state = ViewerState.SLOW

    def dequeue(self) -> Segment | None:
        if not self.queue:
            return None
        return self.queue.popleft()

    def close(self) -> None:
        self.queue.clear()
        self.state = ViewerState.CLOSED


class ViewerRegistry:
    def __init__(self, limit: int = 10, metrics: Metrics | None = None) -> None:
        if limit <= 0:
            raise ValueError("viewer limit must be positive")
        self._limit = limit
        self._metrics = metrics
        self._viewers: dict[str, ViewerSession] = {}

    @property
    def limit(self) -> int:
        return self._limit

    @property
    def count(self) -> int:
        return len(self._viewers)

    def add(self, session_id: str) -> ViewerSession | None:
        if session_id in self._viewers:
            raise ValueError(f"viewer already registered: {session_id}")
        if len(self._viewers) >= self._limit:
            if self._metrics is not None:
                self._metrics.viewer_rejected_total += 1
            return None

        session = ViewerSession(session_id=session_id)
        self._viewers[session_id] = session
        if self._metrics is not None:
            self._metrics.viewer_connections_total += 1
        return session

    def remove(self, session_id: str) -> None:
        session = self._viewers.pop(session_id, None)
        if session is None:
            return
        session.close()
        if self._metrics is not None:
            self._metrics.viewer_disconnects_total += 1

    def broadcast(self, segment: Segment) -> None:
        for session in self._viewers.values():
            session.enqueue(segment)

    def clear(self) -> None:
        for session in self._viewers.values():
            session.close()
        self._viewers.clear()
