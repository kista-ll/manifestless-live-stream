import { describe, expect, it } from "vitest";

import { ControlDecoder, FRAME_HEADER_SIZE, type BinaryFrame, type ControlMessage } from "../src/protocol";
import { TransportClient, type WebTransportLike } from "../src/transportClient";

function makeTransport(): WebTransportLike {
  return {
    ready: Promise.resolve(),
    closed: Promise.resolve(),
    close: () => undefined,
  };
}

function makeFrame(): Uint8Array {
  const payload = new Uint8Array([1, 2, 3]);
  const data = new Uint8Array(FRAME_HEADER_SIZE + payload.byteLength);
  const view = new DataView(data.buffer);
  data.set([77, 76, 83, 80], 0);
  view.setUint8(4, 1);
  view.setUint8(5, 1);
  view.setUint16(6, 1, false);
  view.setBigUint64(8, 0n, false);
  view.setBigUint64(16, 0n, false);
  view.setUint32(24, 0, false);
  view.setUint32(28, payload.byteLength, false);
  data.set(payload, FRAME_HEADER_SIZE);
  return data;
}

describe("TransportClient", () => {
  it("resets retry backoff after connect and caps delays", async () => {
    const client = new TransportClient("https://localhost", () => makeTransport(), {
      control: () => undefined,
      segment: () => undefined,
      error: () => undefined,
    });

    expect(client.nextRetryDelayMs()).toBe(1000);
    expect(client.nextRetryDelayMs()).toBe(2000);
    await client.connect();
    expect(client.nextRetryDelayMs()).toBe(1000);
    expect([client.nextRetryDelayMs(), client.nextRetryDelayMs(), client.nextRetryDelayMs(), client.nextRetryDelayMs()]).toEqual([
      2000,
      4000,
      8000,
      10000,
    ]);
    expect(client.nextRetryDelayMs()).toBe(10000);
  });

  it("decodes control and binary data into sink callbacks", () => {
    const controls: ControlMessage[] = [];
    const segments: BinaryFrame[] = [];
    const errors: Error[] = [];
    const client = new TransportClient("https://localhost", () => makeTransport(), {
      control: (message) => controls.push(message),
      segment: (segment) => segments.push(segment),
      error: (error) => errors.push(error),
    });
    const decoder = new ControlDecoder();

    client.decodeControlChunk(decoder, new TextEncoder().encode('{"type":"stream_ended","lastSequence":1}\n'));
    client.decodeBinaryStream(makeFrame());

    expect(controls).toEqual([{ type: "stream_ended", lastSequence: 1 }]);
    expect(segments[0].type).toBe("init");
    expect(errors).toEqual([]);
  });
});
