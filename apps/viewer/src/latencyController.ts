export interface VideoLike {
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  buffered: TimeRanges;
}

export interface LatencySnapshot {
  liveEdge: number;
  latency: number;
  playbackRate: number;
  seeked: boolean;
  seekFrom: number | null;
  seekTo: number | null;
}

export class LatencyController {
  update(video: VideoLike): LatencySnapshot {
    if (video.buffered.length === 0) {
      video.playbackRate = 1.0;
      return { liveEdge: 0, latency: 0, playbackRate: 1.0, seeked: false, seekFrom: null, seekTo: null };
    }

    const liveEdge = video.buffered.end(video.buffered.length - 1);
    const latency = liveEdge - video.currentTime;
    let seekFrom: number | null = null;
    let seekTo: number | null = null;

    if (video.paused) {
      video.playbackRate = 1.0;
    } else if (latency > 5.0) {
      seekFrom = video.currentTime;
      seekTo = liveEdge - 2.5;
      video.currentTime = seekTo;
      video.playbackRate = 1.0;
    } else if (latency > 3.0) {
      video.playbackRate = 1.05;
    } else {
      video.playbackRate = 1.0;
    }

    return { liveEdge, latency, playbackRate: video.playbackRate, seeked: seekTo !== null, seekFrom, seekTo };
  }
}
