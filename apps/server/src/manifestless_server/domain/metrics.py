from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Metrics:
    segments_registered_total: int = 0
    segments_dropped_total: int = 0
    sequence_gaps_total: int = 0
    viewer_connections_total: int = 0
    viewer_rejected_total: int = 0
    viewer_disconnects_total: int = 0
    bytes_sent_total: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "segmentsRegisteredTotal": self.segments_registered_total,
            "segmentsDroppedTotal": self.segments_dropped_total,
            "sequenceGapsTotal": self.sequence_gaps_total,
            "viewerConnectionsTotal": self.viewer_connections_total,
            "viewerRejectedTotal": self.viewer_rejected_total,
            "viewerDisconnectsTotal": self.viewer_disconnects_total,
            "bytesSentTotal": self.bytes_sent_total,
        }
