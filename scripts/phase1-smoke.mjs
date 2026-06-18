import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = process.cwd();
const mediaDir = join(root, "media", "live");
const port = process.env.SRT_LISTEN_PORT ?? "9000";
const smokeSeconds = Number(process.env.PHASE1_SMOKE_SECONDS ?? "12");
const minSegments = Number(process.env.PHASE1_MIN_SEGMENTS ?? "5");
const segmentPattern = /^segment-(\d{6})\.m4s$/;
const ffmpegLogs = [];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}: ${result.stderr || result.stdout}`);
  }

  return result.stdout;
}

function assertFfmpegSupportsSrt() {
  const version = run("ffmpeg", ["-version"]);
  if (!version.includes("--enable-libsrt")) {
    throw new Error("ffmpeg is not built with --enable-libsrt");
  }

  const protocols = run("ffmpeg", ["-protocols"]);
  if (!protocols.match(/(^|\s)srt(\s|$)/m)) {
    throw new Error("ffmpeg does not list srt protocol support");
  }
}

function clearMediaDir() {
  for (const name of readdirSync(mediaDir)) {
    if (name === ".gitkeep") {
      continue;
    }

    if (
      name === "init.mp4" ||
      name === "internal.mpd" ||
      name === "internal.m3u8" ||
      name.endsWith(".tmp") ||
      name.endsWith(".m4s")
    ) {
      rmSync(join(mediaDir, name), { force: true });
    }
  }
}

function spawnFfmpeg(args, name) {
  const child = spawn("ffmpeg", args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    ffmpegLogs.push(`[${name}] ${chunk.toString()}`);
  });

  child.stderr.on("data", (chunk) => {
    ffmpegLogs.push(`[${name}] ${chunk.toString()}`);
  });

  return child;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function countSegments() {
  return readdirSync(mediaDir)
    .filter((name) => segmentPattern.test(name))
    .sort();
}

function stableFilesPresent() {
  const files = ["init.mp4", ...countSegments().slice(-minSegments)];
  if (files.length < minSegments + 1) {
    return false;
  }

  const before = files.map((name) => statSync(join(mediaDir, name)).size);
  return delay(250).then(() => {
    const after = files.map((name) => statSync(join(mediaDir, name)).size);
    return before.every((size, index) => size > 0 && size === after[index]);
  });
}

function stopProcess(child) {
  if (!child.killed && child.exitCode === null) {
    child.kill("SIGTERM");
  }
}

async function waitForSegments(listener, caller) {
  const deadline = Date.now() + smokeSeconds * 1000;

  while (Date.now() < deadline) {
    if (listener.exitCode !== null) {
      throw new Error(`segmenter exited early with code ${listener.exitCode}`);
    }

    if (caller.exitCode !== null && countSegments().length < minSegments) {
      throw new Error(`caller exited early with code ${caller.exitCode}`);
    }

    if (await stableFilesPresent()) {
      return;
    }

    await delay(500);
  }

  throw new Error(`timed out waiting for init.mp4 and ${minSegments} stable segments`);
}

assertFfmpegSupportsSrt();
clearMediaDir();

const listener = spawnFfmpeg(
  [
    "-hide_banner",
    "-loglevel",
    "info",
    "-fflags",
    "+genpts",
    "-i",
    `srt://0.0.0.0:${port}?mode=listener&latency=200000`,
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
    join(mediaDir, "init.mp4"),
    "-hls_segment_filename",
    join(mediaDir, "segment-%06d.m4s"),
    join(mediaDir, "internal.m3u8"),
  ],
  "segmenter",
);

await delay(1000);

const caller = spawnFfmpeg(
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
    String(smokeSeconds),
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
    `srt://127.0.0.1:${port}?mode=caller&latency=200000&pkt_size=1316`,
  ],
  "caller",
);

try {
  await waitForSegments(listener, caller);
  stopProcess(caller);
  stopProcess(listener);
  run("node", ["scripts/verify-segments.mjs"]);
  console.log(`phase1-smoke: ok segments=${countSegments().length}`);
} catch (error) {
  stopProcess(caller);
  stopProcess(listener);
  console.error(ffmpegLogs.slice(-80).join(""));
  throw error;
}
