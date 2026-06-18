export type PlayerState =
  | "IDLE"
  | "CONNECTING"
  | "INITIALIZING"
  | "BUFFERING"
  | "PLAYING"
  | "CATCHING_UP"
  | "RECONNECTING"
  | "ENDED"
  | "ERROR";

export class PlayerStateMachine {
  state: PlayerState = "IDLE";

  transition(next: PlayerState): void {
    if (this.state === "ENDED" && next === "RECONNECTING") {
      return;
    }
    this.state = next;
  }

  onLatency(latencySeconds: number): void {
    if (this.state !== "PLAYING" && this.state !== "CATCHING_UP") {
      return;
    }
    this.state = latencySeconds > 3 ? "CATCHING_UP" : "PLAYING";
  }

  onStreamEnded(): void {
    this.state = "ENDED";
  }
}
