import type { BinaryFrame } from "./protocol";

export interface ReorderResult {
  ready: BinaryFrame[];
  skippedSequences: number[];
}

interface PendingFrame {
  frame: BinaryFrame;
  receivedAtMs: number;
}

export class SegmentReorderBuffer {
  private expectedSequence: number | null = null;
  private readonly pending = new Map<number, PendingFrame>();

  constructor(
    private readonly maxPendingSegments = 5,
    private readonly gapTimeoutMs = 2000,
  ) {}

  reset(startSequence: number): void {
    this.expectedSequence = startSequence;
    this.pending.clear();
  }

  push(frame: BinaryFrame, nowMs: number): ReorderResult {
    if (frame.type !== "media") {
      return { ready: [frame], skippedSequences: [] };
    }
    if (this.expectedSequence === null) {
      this.expectedSequence = frame.sequence;
    }
    this.pending.set(frame.sequence, { frame, receivedAtMs: nowMs });
    this.trimPending();
    return this.drain(nowMs);
  }

  drain(nowMs: number): ReorderResult {
    const ready: BinaryFrame[] = [];
    const skippedSequences: number[] = [];
    if (this.expectedSequence === null) {
      return { ready, skippedSequences };
    }

    while (true) {
      const pending = this.pending.get(this.expectedSequence);
      if (pending !== undefined) {
        ready.push(pending.frame);
        this.pending.delete(this.expectedSequence);
        this.expectedSequence += 1;
        continue;
      }

      const oldest = [...this.pending.values()].sort((a, b) => a.receivedAtMs - b.receivedAtMs)[0];
      if (oldest === undefined || nowMs - oldest.receivedAtMs < this.gapTimeoutMs) {
        break;
      }

      skippedSequences.push(this.expectedSequence);
      this.expectedSequence += 1;
    }

    return { ready, skippedSequences };
  }

  private trimPending(): void {
    while (this.pending.size > this.maxPendingSegments) {
      const firstSequence = [...this.pending.keys()].sort((a, b) => a - b)[0];
      this.pending.delete(firstSequence);
    }
  }
}
