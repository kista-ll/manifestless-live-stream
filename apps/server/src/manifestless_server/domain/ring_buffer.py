from __future__ import annotations

from collections import OrderedDict

from manifestless_server.domain.metrics import Metrics
from manifestless_server.domain.models import Segment


class SegmentRingBuffer:
    def __init__(self, capacity: int = 30, metrics: Metrics | None = None) -> None:
        if capacity <= 0:
            raise ValueError("ring buffer capacity must be positive")
        self._capacity = capacity
        self._segments: OrderedDict[int, Segment] = OrderedDict()
        self._metrics = metrics
        self.last_gap: tuple[int, int] | None = None

    @property
    def capacity(self) -> int:
        return self._capacity

    @property
    def segment_count(self) -> int:
        return len(self._segments)

    @property
    def oldest_sequence(self) -> int | None:
        return next(iter(self._segments), None)

    @property
    def latest_sequence(self) -> int | None:
        return next(reversed(self._segments), None) if self._segments else None

    def add(self, segment: Segment) -> list[Segment]:
        latest = self.latest_sequence
        if latest is not None and segment.sequence != latest + 1:
            self.last_gap = (latest, segment.sequence)
            if self._metrics is not None:
                self._metrics.sequence_gaps_total += 1

        self._segments[segment.sequence] = segment
        self._segments.move_to_end(segment.sequence)
        if self._metrics is not None:
            self._metrics.segments_registered_total += 1

        dropped: list[Segment] = []
        while len(self._segments) > self._capacity:
            _, old_segment = self._segments.popitem(last=False)
            dropped.append(old_segment)
            if self._metrics is not None:
                self._metrics.segments_dropped_total += 1

        return dropped

    def clear(self) -> None:
        self._segments.clear()
        self.last_gap = None

    def get(self, sequence: int) -> Segment | None:
        return self._segments.get(sequence)

    def list_from(self, start_sequence: int) -> list[Segment]:
        return [
            segment
            for sequence, segment in self._segments.items()
            if sequence >= start_sequence
        ]

    def start_sequence_for_join(self) -> int | None:
        oldest = self.oldest_sequence
        latest = self.latest_sequence
        if oldest is None or latest is None:
            return None
        return max(oldest, latest - 2)
