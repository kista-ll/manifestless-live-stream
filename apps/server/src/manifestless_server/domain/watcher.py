from __future__ import annotations

import re
from pathlib import Path

from manifestless_server.domain.models import Segment
from manifestless_server.domain.ring_buffer import SegmentRingBuffer

SEGMENT_PATTERN = re.compile(r"^segment-(\d{6})\.m4s$")


def parse_segment_sequence(path: Path) -> int | None:
    match = SEGMENT_PATTERN.match(path.name)
    if match is None:
        return None
    return int(match.group(1))


class SegmentWatcher:
    def __init__(self, media_dir: Path, ring_buffer: SegmentRingBuffer) -> None:
        self._media_dir = media_dir
        self._ring_buffer = ring_buffer
        self._seen_sequences: set[int] = set()

    def scan_once(self) -> list[Segment]:
        registered: list[Segment] = []
        candidates = sorted(
            (
                (sequence, path)
                for path in self._media_dir.iterdir()
                if (sequence := parse_segment_sequence(path)) is not None
            ),
            key=lambda item: item[0],
        )

        for sequence, path in candidates:
            if sequence in self._seen_sequences:
                continue
            payload = path.read_bytes()
            segment = Segment(
                sequence=sequence,
                path=path,
                payload=payload,
                pts_ms=(sequence - 1) * 1000,
            )
            self._ring_buffer.add(segment)
            self._seen_sequences.add(sequence)
            registered.append(segment)

        return registered
