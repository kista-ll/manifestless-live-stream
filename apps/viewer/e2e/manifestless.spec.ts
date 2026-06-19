import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

const e2eBlockedReason =
  "Full WebTransport over HTTP/3 browser playback is not wired in this phase; per AGENTS.md this is reported as E2E not executed, not replaced by unit tests.";

const root = resolve("../..");
const mediaDir = resolve(root, "media/live");
const python = process.env.PYTHON ?? "C:/Users/y-aka/AppData/Local/Programs/Python/Python313/python.exe";
const npm = process.env.NPM ?? "C:/Program Files/nodejs/npm.cmd";

let vite: ChildProcessWithoutNullStreams | null = null;
let wtServer: ChildProcessWithoutNullStreams | null = null;
let segmenter: ChildProcessWithoutNullStreams | null = null;
let caller: ChildProcessWithoutNullStreams | null = null;
let certHash = "";

function cleanMedia(): void {
  for (const name of readdirSync(mediaDir)) {
    if (name === ".gitkeep") {
      continue;
    }
    rmSync(resolve(mediaDir, name), { force: true });
  }
}

function spawnLogged(command: string, args: string[], name: string, cwd = root): ChildProcessWithoutNullStreams {
  const isCmd = command.endsWith(".cmd");
  const child = spawn(isCmd ? "cmd.exe" : command, isCmd ? ["/c", command, ...args] : args, {
    cwd,
    env: { ...process.env, MLSP_ROOT: root },
  });
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (name === "wt") {
      const match = /WT_READY certHash=(\S+)/.exec(text);
      if (match !== null) {
        certHash = match[1];
      }
    }
    process.stdout.write(`[${name}] ${text}`);
  });
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[${name}] ${chunk.toString()}`));
  return child;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function mediaSegmentCount(): number {
  return readdirSync(mediaDir).filter((name) => /^segment-\d{6}\.m4s$/.test(name)).length;
}

async function stop(child: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (child !== null && child.exitCode === null) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(resolve, 3000);
    });
  }
}

interface PipelineOptions {
  callerDurationSeconds?: number;
}

interface ViewerHandle {
  index: number;
  context: BrowserContext;
  page: Page;
  connectMs: number;
  firstTime: number;
  firstMetrics: ViewerMetrics;
}

interface ViewerMetrics {
  latestSequence: number;
  startSequence: number;
  firstMediaSequence: number;
  latencySeconds: number;
}

interface StreamApiState {
  state: string;
  viewerCount: number;
  latestSequence: number | null;
  viewerRejectedTotal: number;
}

interface PlayerSnapshot {
  currentTime: number;
  latencySeconds: number;
  playbackRate: number;
  bufferedSeconds: number;
  seekCount: number;
  lastSeekFrom: number | null;
  lastSeekTo: number | null;
  appendQueueLength: number;
  sourceBufferUpdating: boolean;
  mediaSourceReadyState: string;
  endOfStreamCalled: boolean;
  player: string | null;
  lastControlType: string;
  streamEndedLastSequence: number | null;
  reconnectAttempts: number;
  webTransportSessionCount: number;
  latestSequence: number;
  lastReceivedSequence: number | null;
}

interface RejectedViewerResult {
  context: BrowserContext;
  page: Page;
  controlType: string;
  limit: number;
  closeCode: number;
  player: string | null;
}

async function startPipeline(options: PipelineOptions = {}): Promise<void> {
  const callerDurationSeconds = options.callerDurationSeconds ?? 30;
  cleanMedia();
  wtServer = spawnLogged(python, ["-m", "manifestless_server.e2e_server"], "wt");
  await waitFor(() => certHash !== "", 15000, "WebTransport server");
  vite = spawnLogged(npm, ["--prefix", "apps/viewer", "run", "dev", "--", "--host", "127.0.0.1"], "vite");
  await waitFor(async () => {
    try {
      const response = await fetch("http://127.0.0.1:5173");
      return response.ok;
    } catch {
      return false;
    }
  }, 15000, "Vite dev server");
  segmenter = spawnLogged(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "info",
      "-fflags",
      "+genpts",
      "-i",
      "srt://0.0.0.0:9000?mode=listener&latency=200000",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-level:v",
      "3.1",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-b:v",
      "2M",
      "-maxrate",
      "2M",
      "-bufsize",
      "4M",
      "-g",
      "30",
      "-keyint_min",
      "30",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "hls",
      "-hls_segment_type",
      "fmp4",
      "-hls_time",
      "1",
      "-hls_flags",
      "independent_segments",
      "-start_number",
      "1",
      "-hls_fmp4_init_filename",
      resolve(mediaDir, "init.mp4"),
      "-hls_segment_filename",
      resolve(mediaDir, "segment-%06d.m4s"),
      resolve(mediaDir, "internal.m3u8"),
    ],
    "segmenter",
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  caller = spawnLogged(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "info",
      "-re",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:sample_rate=48000",
      "-t",
      String(callerDurationSeconds),
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-level:v",
      "3.1",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-b:v",
      "2M",
      "-maxrate",
      "2M",
      "-bufsize",
      "4M",
      "-g",
      "30",
      "-keyint_min",
      "30",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "mpegts",
      "srt://127.0.0.1:9000?mode=caller&latency=200000&pkt_size=1316",
    ],
    "caller",
  );
  await waitFor(
    () => existsSync(resolve(mediaDir, "init.mp4")) && statSync(resolve(mediaDir, "init.mp4")).size > 0 && mediaSegmentCount() >= 3,
    15000,
    "init and media segments",
  );
}

async function connectViewer(page: Page): Promise<void> {
  const wt = encodeURIComponent("https://127.0.0.1:4433/webtransport/live-001");
  await page.goto(`http://127.0.0.1:5173/?wt=${wt}&certHash=${encodeURIComponent(certHash)}`);
  await page.locator("#app main").waitFor({ timeout: 10000 });
  await expect(page.locator("#app")).toHaveAttribute("data-webtransport-ready", "true", {
    timeout: 20000,
  });
  await expect(page.locator("#app")).toHaveAttribute("data-init-received", "true", {
    timeout: 20000,
  });
  await expect(page.locator("#app")).toHaveAttribute("data-media-received", "true", {
    timeout: 20000,
  });
  await expect(page.locator("#player")).toContainText("PLAYING", { timeout: 20000 });
}

async function readViewerMetrics(page: Page): Promise<ViewerMetrics> {
  return page.locator("#app").evaluate((node) => {
    const element = node as HTMLElement;
    return {
      latestSequence: Number(element.dataset.latestSequence),
      startSequence: Number(element.dataset.startSequence),
      firstMediaSequence: Number(element.dataset.firstMediaSequence),
      latencySeconds: Number(element.dataset.latencySeconds),
    };
  });
}

async function readStreamApiState(): Promise<StreamApiState> {
  const response = await fetch("http://127.0.0.1:8000/api/stream");
  if (!response.ok) {
    throw new Error(`stream API failed: ${response.status}`);
  }
  return (await response.json()) as StreamApiState;
}

async function requestStreamEnd(): Promise<void> {
  const response = await fetch("http://127.0.0.1:8000/api/stream/end", { method: "POST" });
  if (!response.ok) {
    throw new Error(`stream end API failed: ${response.status}`);
  }
}

async function readPlayerSnapshot(page: Page): Promise<PlayerSnapshot> {
  return page.locator("#app").evaluate((node) => {
    const element = node as HTMLElement;
    const numberOrNull = (value: string | undefined): number | null =>
      value === undefined || value === "" ? null : Number(value);
    return {
      currentTime: Number(element.dataset.currentTime),
      latencySeconds: Number(element.dataset.latencySeconds),
      playbackRate: Number(element.dataset.playbackRate),
      bufferedSeconds: Number(element.dataset.bufferedSeconds),
      seekCount: Number(element.dataset.seekCount ?? "0"),
      lastSeekFrom: numberOrNull(element.dataset.lastSeekFrom),
      lastSeekTo: numberOrNull(element.dataset.lastSeekTo),
      appendQueueLength: Number(element.dataset.appendQueueLength ?? "0"),
      sourceBufferUpdating: element.dataset.sourceBufferUpdating === "true",
      mediaSourceReadyState: element.dataset.mediaSourceReadyState ?? "",
      endOfStreamCalled: element.dataset.endOfStreamCalled === "true",
      player: element.dataset.player ?? null,
      lastControlType: element.dataset.lastControlType ?? "",
      streamEndedLastSequence: numberOrNull(element.dataset.streamEndedLastSequence),
      reconnectAttempts: Number(element.dataset.reconnectAttempts ?? "0"),
      webTransportSessionCount: Number(element.dataset.webTransportSessionCount ?? "0"),
      latestSequence: Number(element.dataset.latestSequence),
      lastReceivedSequence: numberOrNull(element.dataset.sequence),
    };
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function openViewer(browser: Browser, index: number): Promise<ViewerHandle> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const connectedAt = Date.now();
    await connectViewer(page);
    const connectMs = Date.now() - connectedAt;
    const firstTime = await page.locator("video").evaluate((video) => (video as HTMLVideoElement).currentTime);
    const firstMetrics = await readViewerMetrics(page);
    return { index, context, page, connectMs, firstTime, firstMetrics };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function openRejectedViewer(browser: Browser): Promise<RejectedViewerResult> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const wt = encodeURIComponent("https://127.0.0.1:4433/webtransport/live-001");
    await page.goto(`http://127.0.0.1:5173/?wt=${wt}&certHash=${encodeURIComponent(certHash)}`);
    await expect(page.locator("#app")).toHaveAttribute("data-webtransport-ready", "true", {
      timeout: 10000,
    });
    await expect(page.locator("#app")).toHaveAttribute("data-last-control-type", "capacity_exceeded", {
      timeout: 10000,
    });
    await expect(page.locator("#app")).toHaveAttribute("data-capacity-limit", "10", {
      timeout: 10000,
    });
    await expect(page.locator("#app")).toHaveAttribute("data-transport-closed", "true", {
      timeout: 10000,
    });
    await expect(page.locator("#app")).toHaveAttribute("data-transport-close-code", "257", {
      timeout: 10000,
    });
    const player = await page.locator("#player").textContent();
    expect(player).not.toBe("PLAYING");
    const result = await page.locator("#app").evaluate((node) => {
      const element = node as HTMLElement;
      return {
        controlType: element.dataset.lastControlType ?? "",
        limit: Number(element.dataset.capacityLimit),
        closeCode: Number(element.dataset.transportCloseCode),
      };
    });
    return { context, page, player, ...result };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function pageAssertionsForAllViewers(handles: ViewerHandle[], durationMs: number): Promise<void> {
  for (const handle of handles) {
    await expect(handle.page.locator("#app")).toHaveAttribute("data-webtransport-ready", "true");
    await expect(handle.page.locator("#player")).toContainText("PLAYING");
  }
  await delay(durationMs);
  for (const handle of handles) {
    await expect(handle.page.locator("#player")).toContainText("PLAYING");
  }
}

test.afterEach(async () => {
  await stop(caller);
  await stop(segmenter);
  await stop(vite);
  await stop(wtServer);
  caller = null;
  segmenter = null;
  vite = null;
  wtServer = null;
  certHash = "";
});

test.describe("manifestless live streaming acceptance E2E", () => {
  test("E2E-001 basic playback", async ({ page }) => {
    test.setTimeout(60000);
    await startPipeline();
    await connectViewer(page);
    const firstTime = await page.locator("video").evaluate((video) => (video as HTMLVideoElement).currentTime);
    await page.waitForTimeout(3000);
    const secondTime = await page.locator("video").evaluate((video) => (video as HTMLVideoElement).currentTime);
    expect(secondTime).toBeGreaterThan(firstTime + 0.5);
  });

  test("E2E-002 late join", async ({ page }) => {
    test.setTimeout(120000);
    const startedAt = Date.now();
    await startPipeline({ callerDurationSeconds: 90 });
    await waitFor(() => mediaSegmentCount() >= 35, 45000, "at least 35 generated media segments");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30000);

    const connectedAt = Date.now();
    await connectViewer(page);
    const playbackStartedAt = Date.now();
    const metricsAtStart = await readViewerMetrics(page);
    const oldestSequence = Math.max(1, metricsAtStart.latestSequence - 29);
    const expectedStartSequence = Math.max(oldestSequence, metricsAtStart.latestSequence - 2);
    const firstTime = await page.locator("video").evaluate((video) => (video as HTMLVideoElement).currentTime);

    expect(metricsAtStart.startSequence).toBe(expectedStartSequence);
    expect(metricsAtStart.firstMediaSequence).toBe(metricsAtStart.startSequence);
    expect(metricsAtStart.firstMediaSequence).toBeGreaterThan(oldestSequence);
    expect(playbackStartedAt - connectedAt).toBeLessThanOrEqual(10000);

    await page.waitForTimeout(30000);
    const secondTime = await page.locator("video").evaluate((video) => (video as HTMLVideoElement).currentTime);
    const metricsAfter30Seconds = await readViewerMetrics(page);

    expect(secondTime).toBeGreaterThan(firstTime + 0.5);
    expect(metricsAfter30Seconds.latencySeconds).toBeLessThanOrEqual(5);

    console.log(
      JSON.stringify({
        e2e: "E2E-002",
        oldestSequence,
        latestSequence: metricsAtStart.latestSequence,
        startSequence: metricsAtStart.startSequence,
        firstMediaSequence: metricsAtStart.firstMediaSequence,
        playbackStartMs: playbackStartedAt - connectedAt,
        latencyAtPlaybackStart: metricsAtStart.latencySeconds,
        latencyAfter30Seconds: metricsAfter30Seconds.latencySeconds,
      }),
    );
  });

  test("E2E-003 ten viewers", async ({ browser }) => {
    test.setTimeout(120000);
    await startPipeline({ callerDurationSeconds: 90 });
    const handles: ViewerHandle[] = [];
    try {
      const attempts = await Promise.all(
        Array.from({ length: 10 }, async (_, index) => {
          await delay(index * 250);
          try {
            const handle = await openViewer(browser, index + 1);
            handles.push(handle);
            return { index: index + 1, ok: true as const };
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { index: index + 1, ok: false as const, error: message };
          }
        }),
      );
      const failures = attempts.filter((result) => !result.ok);
      if (failures.length > 0) {
        console.log(JSON.stringify({ e2e: "E2E-003", stage: "connect", failures }));
      }
      expect(failures).toEqual([]);
      expect(handles).toHaveLength(10);

      const apiState = await readStreamApiState();
      expect(apiState.viewerCount).toBe(10);

      await pageAssertionsForAllViewers(handles, 30000);
      const summary = await Promise.all(
        handles.map(async (handle) => {
          const secondTime = await handle.page
            .locator("video")
            .evaluate((video) => (video as HTMLVideoElement).currentTime);
          const metrics = await readViewerMetrics(handle.page);
          const player = await handle.page.locator("#player").textContent();
          return {
            viewer: handle.index,
            connected: true,
            player,
            connectMs: handle.connectMs,
            firstSequence: handle.firstMetrics.firstMediaSequence,
            latestSequence: metrics.latestSequence,
            firstCurrentTime: Number(handle.firstTime.toFixed(3)),
            secondCurrentTime: Number(secondTime.toFixed(3)),
            increased: secondTime > handle.firstTime + 0.5,
          };
        }),
      );
      const finalApiState = await readStreamApiState();
      console.log(
        JSON.stringify({
          e2e: "E2E-003",
          viewerCount: finalApiState.viewerCount,
          latestSequence: finalApiState.latestSequence,
          viewers: summary,
        }),
      );

      expect(finalApiState.viewerCount).toBe(10);
      expect(summary.every((viewer) => viewer.player === "PLAYING")).toBe(true);
      expect(summary.every((viewer) => viewer.increased)).toBe(true);
    } finally {
      await Promise.all(handles.map((handle) => handle.context.close()));
    }
  });

  test("E2E-004 capacity rejection", async ({ browser }) => {
    test.setTimeout(120000);
    await startPipeline({ callerDurationSeconds: 90 });
    const handles: ViewerHandle[] = [];
    let rejected: RejectedViewerResult | null = null;
    try {
      const attempts = await Promise.all(
        Array.from({ length: 10 }, async (_, index) => {
          await delay(index * 250);
          try {
            const handle = await openViewer(browser, index + 1);
            handles.push(handle);
            return { index: index + 1, ok: true as const };
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { index: index + 1, ok: false as const, error: message };
          }
        }),
      );
      const failures = attempts.filter((result) => !result.ok);
      if (failures.length > 0) {
        console.log(JSON.stringify({ e2e: "E2E-004", stage: "initial-connect", failures }));
      }
      expect(failures).toEqual([]);
      expect(handles).toHaveLength(10);

      for (const handle of handles) {
        await expect(handle.page.locator("#player")).toContainText("PLAYING");
      }
      const beforeApiState = await readStreamApiState();
      expect(beforeApiState.viewerCount).toBe(10);
      const beforeTimes = await Promise.all(
        handles.map(async (handle) => ({
          viewer: handle.index,
          currentTime: await handle.page
            .locator("video")
            .evaluate((video) => (video as HTMLVideoElement).currentTime),
        })),
      );

      rejected = await openRejectedViewer(browser);
      expect(rejected.controlType).toBe("capacity_exceeded");
      expect(rejected.limit).toBe(10);
      expect(rejected.closeCode).toBe(0x101);

      const afterRejectApiState = await readStreamApiState();
      expect(afterRejectApiState.viewerCount).toBe(10);
      expect(afterRejectApiState.viewerRejectedTotal).toBe(beforeApiState.viewerRejectedTotal + 1);

      await delay(10000);
      const summary = await Promise.all(
        handles.map(async (handle) => {
          const before = beforeTimes.find((entry) => entry.viewer === handle.index);
          if (before === undefined) {
            throw new Error(`missing before currentTime for viewer ${handle.index}`);
          }
          const after = await handle.page
            .locator("video")
            .evaluate((video) => (video as HTMLVideoElement).currentTime);
          const player = await handle.page.locator("#player").textContent();
          return {
            viewer: handle.index,
            player,
            beforeCurrentTime: Number(before.currentTime.toFixed(3)),
            afterCurrentTime: Number(after.toFixed(3)),
            increased: after > before.currentTime + 0.5,
          };
        }),
      );
      const finalApiState = await readStreamApiState();
      console.log(
        JSON.stringify({
          e2e: "E2E-004",
          rejected: {
            controlType: rejected.controlType,
            limit: rejected.limit,
            closeCode: rejected.closeCode,
            player: rejected.player,
          },
          viewerCountBefore: beforeApiState.viewerCount,
          viewerCountAfterReject: afterRejectApiState.viewerCount,
          viewerCountAfter10Seconds: finalApiState.viewerCount,
          viewerRejectedTotalBefore: beforeApiState.viewerRejectedTotal,
          viewerRejectedTotalAfter: finalApiState.viewerRejectedTotal,
          viewers: summary,
        }),
      );

      expect(finalApiState.viewerCount).toBe(10);
      expect(finalApiState.viewerRejectedTotal).toBe(beforeApiState.viewerRejectedTotal + 1);
      expect(summary.every((viewer) => viewer.player === "PLAYING")).toBe(true);
      expect(summary.every((viewer) => viewer.increased)).toBe(true);
    } finally {
      await rejected?.context.close();
      await Promise.all(handles.map((handle) => handle.context.close()));
    }
  });

  test("E2E-005 catch up after pause", async ({ page }) => {
    test.setTimeout(120000);
    await startPipeline({ callerDurationSeconds: 80 });
    await connectViewer(page);
    await expect(page.locator("#player")).toContainText("PLAYING");

    await page.waitForTimeout(1500);
    await page.locator("video").evaluate((video) => (video as HTMLVideoElement).pause());
    await expect
      .poll(
        async () => {
          const snapshot = await readPlayerSnapshot(page);
          return snapshot.latencySeconds > 3 && snapshot.latencySeconds <= 5;
        },
        { timeout: 6000 },
      )
      .toBe(true);
    await page.locator("video").evaluate(async (video) => {
      await (video as HTMLVideoElement).play();
    });
    let catchUpRateSnapshot: PlayerSnapshot | null = null;
    await expect
      .poll(
        async () => {
          const snapshot = await readPlayerSnapshot(page);
          if (
            snapshot.latencySeconds > 3 &&
            snapshot.latencySeconds <= 5 &&
            Math.abs(snapshot.playbackRate - 1.05) < 0.01
          ) {
            catchUpRateSnapshot = snapshot;
            return true;
          }
          return false;
        },
        { timeout: 5000 },
      )
      .toBe(true);

    const beforePause = await readPlayerSnapshot(page);
    await page.locator("video").evaluate((video) => (video as HTMLVideoElement).pause());
    await page.waitForTimeout(10000);
    const afterPause = await readPlayerSnapshot(page);
    const seekCountBeforeResume = afterPause.seekCount;
    const currentTimeBeforeResume = await page
      .locator("video")
      .evaluate((video) => (video as HTMLVideoElement).currentTime);

    expect(afterPause.currentTime).toBeLessThanOrEqual(beforePause.currentTime + 1);
    expect(afterPause.latencySeconds).toBeGreaterThan(beforePause.latencySeconds + 5);

    await page.locator("video").evaluate(async (video) => {
      await (video as HTMLVideoElement).play();
    });
    const resumedAt = Date.now();

    await expect.poll(async () => (await readPlayerSnapshot(page)).seekCount, { timeout: 10000 }).toBeGreaterThan(
      seekCountBeforeResume,
    );
    const afterSeek = await readPlayerSnapshot(page);
    expect(afterSeek.lastSeekFrom).not.toBeNull();
    expect(afterSeek.lastSeekTo).not.toBeNull();
    expect(afterSeek.lastSeekFrom ?? 0).toBeLessThanOrEqual(currentTimeBeforeResume + 1);
    expect(afterSeek.lastSeekTo ?? 0).toBeGreaterThan(afterSeek.lastSeekFrom ?? 0);

    await expect.poll(async () => (await readPlayerSnapshot(page)).latencySeconds, { timeout: 30000 }).toBeLessThanOrEqual(
      5,
    );
    await expect.poll(async () => (await readPlayerSnapshot(page)).playbackRate, { timeout: 30000 }).toBe(1);
    const caughtUpAt = Date.now();
    const finalSnapshot = await readPlayerSnapshot(page);
    const finalCurrentTime = await page.locator("video").evaluate((video) => (video as HTMLVideoElement).currentTime);

    expect(finalCurrentTime).toBeGreaterThan(afterSeek.currentTime + 0.5);
    expect(finalSnapshot.player).toBe("PLAYING");

    console.log(
      JSON.stringify({
        e2e: "E2E-005",
        beforePause: {
          currentTime: Number(beforePause.currentTime.toFixed(3)),
          latency: Number(beforePause.latencySeconds.toFixed(3)),
        },
        afterPause: {
          currentTime: Number(afterPause.currentTime.toFixed(3)),
          latency: Number(afterPause.latencySeconds.toFixed(3)),
        },
        resume: {
          playbackRate: Number(afterSeek.playbackRate.toFixed(3)),
          currentTimeBeforeResume: Number(currentTimeBeforeResume.toFixed(3)),
        },
        seek: {
          executed: afterSeek.seekCount > seekCountBeforeResume,
          from: afterSeek.lastSeekFrom,
          to: afterSeek.lastSeekTo,
        },
        catchUpRate: catchUpRateSnapshot,
        caughtUpMs: caughtUpAt - resumedAt,
        final: {
          currentTime: Number(finalCurrentTime.toFixed(3)),
          latency: Number(finalSnapshot.latencySeconds.toFixed(3)),
          playbackRate: Number(finalSnapshot.playbackRate.toFixed(3)),
          player: finalSnapshot.player,
        },
      }),
    );
  });

  test("E2E-006 stream end", async ({ page }) => {
    test.setTimeout(90000);
    await startPipeline({ callerDurationSeconds: 80 });
    await connectViewer(page);
    const beforeEnd = await readPlayerSnapshot(page);
    const beforeApi = await readStreamApiState();
    expect(beforeEnd.player).toBe("PLAYING");
    expect(beforeApi.viewerCount).toBe(1);

    const endedAt = Date.now();
    await requestStreamEnd();
    await expect(page.locator("#app")).toHaveAttribute("data-last-control-type", "stream_ended", {
      timeout: 10000,
    });
    const streamEnded = await readPlayerSnapshot(page);
    expect(streamEnded.streamEndedLastSequence).not.toBeNull();

    await expect.poll(async () => (await readPlayerSnapshot(page)).appendQueueLength, { timeout: 10000 }).toBe(0);
    await expect.poll(async () => (await readPlayerSnapshot(page)).sourceBufferUpdating, { timeout: 10000 }).toBe(false);
    await expect.poll(async () => (await readPlayerSnapshot(page)).endOfStreamCalled, { timeout: 10000 }).toBe(true);
    await expect.poll(async () => (await readPlayerSnapshot(page)).mediaSourceReadyState, { timeout: 10000 }).toBe("ended");
    await expect(page.locator("#player")).toContainText("ENDED", { timeout: 10000 });
    const finalAtEnd = await readPlayerSnapshot(page);
    const endedMs = Date.now() - endedAt;

    await expect.poll(async () => (await readStreamApiState()).viewerCount, { timeout: 10000 }).toBe(0);
    const afterApi = await readStreamApiState();
    expect(afterApi.state).toBe("ENDED");

    await page.waitForTimeout(15000);
    const after15Seconds = await readPlayerSnapshot(page);
    const after15Api = await readStreamApiState();
    expect(after15Seconds.reconnectAttempts).toBe(0);
    expect(after15Seconds.webTransportSessionCount).toBe(beforeEnd.webTransportSessionCount);
    expect(after15Seconds.player).toBe("ENDED");
    expect(after15Api.viewerCount).toBe(0);
    expect(after15Api.state).toBe("ENDED");

    console.log(
      JSON.stringify({
        e2e: "E2E-006",
        beforeEnd: {
          player: beforeEnd.player,
          viewerCount: beforeApi.viewerCount,
          sessionCount: beforeEnd.webTransportSessionCount,
        },
        streamEnded: {
          lastSequence: streamEnded.streamEndedLastSequence,
          lastReceivedSequence: finalAtEnd.lastReceivedSequence,
        },
        queue: {
          appendQueueLength: finalAtEnd.appendQueueLength,
          sourceBufferUpdating: finalAtEnd.sourceBufferUpdating,
        },
        mediaSourceReadyState: finalAtEnd.mediaSourceReadyState,
        endedMs,
        reconnectAttemptsAfter15Seconds: after15Seconds.reconnectAttempts,
        webTransportSessionCountAfter15Seconds: after15Seconds.webTransportSessionCount,
        afterEnd: {
          viewerCount: after15Api.viewerCount,
          state: after15Api.state,
          player: after15Seconds.player,
        },
      }),
    );
  });

  test("E2E-007 SRT reconnect", () => {
    test.skip(true, e2eBlockedReason);
  });

  test("E2E-008 invalid ingest", () => {
    test.skip(true, e2eBlockedReason);
  });
});
