import { expect, test } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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

function stop(child: ChildProcessWithoutNullStreams | null): void {
  if (child !== null && child.exitCode === null) {
    child.kill("SIGTERM");
  }
}

async function startPipeline(): Promise<void> {
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
      "30",
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

test.afterEach(() => {
  stop(caller);
  stop(segmenter);
  stop(vite);
  stop(wtServer);
});

test.describe("manifestless live streaming acceptance E2E", () => {
  test("E2E-001 basic playback", async ({ page }) => {
    await startPipeline();
    const wt = encodeURIComponent("https://127.0.0.1:4433/webtransport/live-001");
    await page.goto(`http://127.0.0.1:5173/?wt=${wt}&certHash=${encodeURIComponent(certHash)}`);
    await expect(page.locator("#app")).toHaveAttribute("data-webtransport-ready", "true", {
      timeout: 10000,
    });
    await expect(page.locator("#app")).toHaveAttribute("data-init-received", "true", {
      timeout: 10000,
    });
    await expect(page.locator("#app")).toHaveAttribute("data-media-received", "true", {
      timeout: 10000,
    });
    await expect(page.locator("#player")).toContainText("PLAYING", { timeout: 10000 });
    const firstTime = await page.locator("video").evaluate((video) => (video as HTMLVideoElement).currentTime);
    await page.waitForTimeout(3000);
    const secondTime = await page.locator("video").evaluate((video) => (video as HTMLVideoElement).currentTime);
    expect(secondTime).toBeGreaterThan(firstTime + 0.5);
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
