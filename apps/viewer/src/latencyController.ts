export interface VideoLike {
  currentTime: number;
  playbackRate: number;
  buffered: TimeRanges;
}

export interface LatencySnapshot {
  liveEdge: number;
  latency: number;
  playbackRate: number;
}

export class LatencyController {
  update(video: VideoLike): LatencySnapshot {
    if (video.buffered.length === 0) {
      video.playbackRate = 1.0;
      return { liveEdge: 0, latency: 0, playbackRate: 1.0 };
    }

    const liveEdge = video.buffered.end(video.buffered.length - 1);
    const latency = liveEdge - video.currentTime;

    if (latency > 5.0) {
      video.currentTime = liveEdge - 2.5;
      video.playbackRate = 1.0;
    } else if (latency > 3.0) {
      video.playbackRate = 1.05;
    } else {
      video.playbackRate = 1.0;
    }

    return { liveEdge, latency, playbackRate: video.playbackRate };
  }
}
