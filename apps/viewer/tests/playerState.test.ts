import { describe, expect, it } from "vitest";

import { PlayerStateMachine } from "../src/playerState";

describe("PlayerStateMachine", () => {
  it("moves between playing and catching up based on latency", () => {
    const machine = new PlayerStateMachine();
    machine.transition("PLAYING");

    machine.onLatency(4);
    expect(machine.state).toBe("CATCHING_UP");
    machine.onLatency(2);
    expect(machine.state).toBe("PLAYING");
  });

  it("does not reconnect after stream ended", () => {
    const machine = new PlayerStateMachine();

    machine.onStreamEnded();
    machine.transition("RECONNECTING");

    expect(machine.state).toBe("ENDED");
  });
});
