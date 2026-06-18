import { test } from "@playwright/test";

const e2eBlockedReason =
  "Full WebTransport over HTTP/3 browser playback is not wired in this phase; per AGENTS.md this is reported as E2E not executed, not replaced by unit tests.";

test.describe("manifestless live streaming acceptance E2E", () => {
  test("E2E-001 basic playback", () => {
    test.skip(true, e2eBlockedReason);
  });

  test("E2E-002 late join", () => {
    test.skip(true, e2eBlockedReason);
  });

  test("E2E-003 ten viewers", () => {
    test.skip(true, e2eBlockedReason);
  });

  test("E2E-004 capacity rejection", () => {
    test.skip(true, e2eBlockedReason);
  });

  test("E2E-005 catch up after pause", () => {
    test.skip(true, e2eBlockedReason);
  });

  test("E2E-006 stream end", () => {
    test.skip(true, e2eBlockedReason);
  });

  test("E2E-007 SRT reconnect", () => {
    test.skip(true, e2eBlockedReason);
  });

  test("E2E-008 invalid ingest", () => {
    test.skip(true, e2eBlockedReason);
  });
});
