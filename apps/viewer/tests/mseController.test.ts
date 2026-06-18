import { describe, expect, it, vi } from "vitest";

import { MseController, type MediaSourceLike, type SourceBufferLike } from "../src/mseController";
import type { BinaryFrame } from "../src/protocol";

class FakeTimeRanges implements TimeRanges {
  constructor(private readonly ranges: Array<[number, number]>) {}

  get length(): number {
    return this.ranges.length;
  }

  start(index: number): number {
    return this.ranges[index][0];
  }

  end(index: number): number {
    return this.ranges[index][1];
  }
}

class FakeSourceBuffer extends EventTarget implements SourceBufferLike {
  updating = false;
  buffered: TimeRanges = new FakeTimeRanges([[0, 10]]);
  appendCalls: Uint8Array[] = [];
  removeCalls: Array<[number, number]> = [];

  appendBuffer(data: BufferSource): void {
    this.updating = true;
    this.appendCalls.push(new Uint8Array(data as ArrayBuffer));
  }

  remove(start: number, end: number): void {
    this.updating = true;
    this.removeCalls.push([start, end]);
  }

  finishUpdate(): void {
    this.updating = false;
    this.dispatchEvent(new Event("updateend"));
  }
}

class FakeMediaSource extends EventTarget implements MediaSourceLike {
  readyState = "open";
  sourceBuffer = new FakeSourceBuffer();
  ended = false;

  addSourceBuffer(): SourceBufferLike {
    return this.sourceBuffer;
  }

  endOfStream(): void {
    this.ended = true;
  }
}

function frame(value: number): BinaryFrame {
  return {
    type: "media",
    sequence: value,
    ptsMs: value * 1000,
    durationMs: 1000,
    independent: true,
    payload: new Uint8Array([value]),
  };
}

describe("MseController", () => {
  it("serializes appends while SourceBuffer is updating", () => {
    vi.stubGlobal("MediaSource", { isTypeSupported: () => true });
    const mediaSource = new FakeMediaSource();
    const controller = new MseController(mediaSource);

    controller.initialize("video/mp4");
    controller.append(frame(1));
    controller.append(frame(2));

    expect(mediaSource.sourceBuffer.appendCalls).toHaveLength(1);
    mediaSource.sourceBuffer.finishUpdate();
    expect(mediaSource.sourceBuffer.appendCalls).toHaveLength(2);
  });

  it("queues remove and end operations after append", () => {
    vi.stubGlobal("MediaSource", { isTypeSupported: () => true });
    const mediaSource = new FakeMediaSource();
    const controller = new MseController(mediaSource);

    controller.initialize("video/mp4");
    controller.append(frame(1));
    controller.removeBefore(8);
    controller.endWhenIdle();

    mediaSource.sourceBuffer.finishUpdate();
    expect(mediaSource.sourceBuffer.removeCalls).toEqual([[0, 3]]);
    mediaSource.sourceBuffer.finishUpdate();
    expect(mediaSource.ended).toBe(true);
  });
});
