import { describe, expect, it } from "vitest";

describe("phase0", () => {
  it("has a test harness", () => {
    expect("manifestless").toContain("manifest");
  });
});
