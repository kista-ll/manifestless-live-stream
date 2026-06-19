import { describe, expect, it } from "vitest";

import { LatencyController, type VideoLike } from "../src/latencyController";

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

function video(currentTime: number, liveEdge: number): VideoLike {
  return {
    currentTime,
    playbackRate: 1.0,
    paused: false,
    buffered: new FakeTimeRanges([[0, liveEdge]]),
  };
}

describe("LatencyController", () => {
  it("seeks to live edge minus target when latency exceeds max", () => {
    const target = video(1, 10);
    const snapshot = new LatencyController().update(target);

    expect(snapshot.latency).toBe(9);
    expect(target.currentTime).toBe(7.5);
    expect(target.playbackRate).toBe(1.0);
  });

  it("uses 1.05 playbackRate while catching up", () => {
    const target = video(6, 10);

    new LatencyController().update(target);

    expect(target.playbackRate).toBe(1.05);
  });

  it("returns playbackRate to normal near live edge", () => {
    const target = video(8, 10);

    new LatencyController().update(target);

    expect(target.playbackRate).toBe(1.0);
  });

  it("does not seek while playback is paused", () => {
    const target = video(1, 10);
    target.paused = true;

    const snapshot = new LatencyController().update(target);

    expect(snapshot.latency).toBe(9);
    expect(snapshot.seeked).toBe(false);
    expect(target.currentTime).toBe(1);
    expect(target.playbackRate).toBe(1.0);
  });
});
