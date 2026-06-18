import { describe, expect, it } from "vitest";

import { ControlDecoder, decodeBinaryFrame, FRAME_HEADER_SIZE } from "../src/protocol";

function makeFrame(sequence: number): Uint8Array {
  const payload = new TextEncoder().encode("payload");
  const data = new Uint8Array(FRAME_HEADER_SIZE + payload.byteLength);
  const view = new DataView(data.buffer);
  data.set([77, 76, 83, 80], 0);
  view.setUint8(4, 1);
  view.setUint8(5, 2);
  view.setUint16(6, 1, false);
  view.setBigUint64(8, BigInt(sequence), false);
  view.setBigUint64(16, BigInt((sequence - 1) * 1000), false);
  view.setUint32(24, 1000, false);
  view.setUint32(28, payload.byteLength, false);
  data.set(payload, FRAME_HEADER_SIZE);
  return data;
}

describe("ControlDecoder", () => {
  it("reassembles split NDJSON", () => {
    const decoder = new ControlDecoder();
    const encoded = new TextEncoder().encode(
      '{"type":"stream_ended","lastSequence":10}\n{"type":"capacity_exceeded","limit":10}\n',
    );

    expect(decoder.feed(encoded.slice(0, 12))).toEqual([]);
    expect(decoder.feed(encoded.slice(12))).toEqual([
      { type: "stream_ended", lastSequence: 10 },
      { type: "capacity_exceeded", limit: 10 },
    ]);
  });
});

describe("decodeBinaryFrame", () => {
  it("decodes the specified binary header", () => {
    const frame = decodeBinaryFrame(makeFrame(42));

    expect(frame.type).toBe("media");
    expect(frame.sequence).toBe(42);
    expect(frame.ptsMs).toBe(41000);
    expect(frame.durationMs).toBe(1000);
    expect(frame.independent).toBe(true);
    expect(new TextDecoder().decode(frame.payload)).toBe("payload");
  });
});
