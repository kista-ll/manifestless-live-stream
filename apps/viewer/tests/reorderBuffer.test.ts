import { describe, expect, it } from "vitest";

import type { BinaryFrame } from "../src/protocol";
import { SegmentReorderBuffer } from "../src/reorderBuffer";

function frame(sequence: number): BinaryFrame {
  return {
    type: "media",
    sequence,
    ptsMs: (sequence - 1) * 1000,
    durationMs: 1000,
    independent: true,
    payload: new Uint8Array([sequence]),
  };
}

describe("SegmentReorderBuffer", () => {
  it("emits out-of-order segments in sequence order", () => {
    const buffer = new SegmentReorderBuffer();
    buffer.reset(1);

    expect(buffer.push(frame(2), 0).ready).toEqual([]);
    expect(buffer.push(frame(1), 10).ready.map((item) => item.sequence)).toEqual([1, 2]);
  });

  it("skips a missing segment after the gap timeout", () => {
    const buffer = new SegmentReorderBuffer(5, 2000);
    buffer.reset(1);

    buffer.push(frame(2), 0);
    const result = buffer.drain(2001);

    expect(result.skippedSequences).toEqual([1]);
    expect(result.ready.map((item) => item.sequence)).toEqual([2]);
  });
});
