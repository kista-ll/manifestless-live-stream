import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const root = process.cwd();
const mediaDir = process.env.MEDIA_DIR ?? join(root, "media", "live");
const skipWhenEmpty = args.has("--skip-when-empty");
const segmentPattern = /^segment-(\d{6})\.m4s$/;

function fail(message) {
  throw new Error(message);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    fail(`${command} failed with status ${result.status}: ${result.stderr || result.stdout}`);
  }

  return result.stdout;
}

const entries = readdirSync(mediaDir);
const initPath = join(mediaDir, "init.mp4");
const playlistPath = join(mediaDir, "internal.m3u8");
const segments = entries
  .map((name) => {
    const match = segmentPattern.exec(name);
    return match ? { name, sequence: Number(match[1]) } : null;
  })
  .filter((entry) => entry !== null)
  .sort((a, b) => a.sequence - b.sequence);

if (skipWhenEmpty && segments.length === 0) {
  console.log("verify-segments: skipped, no media segments present");
  process.exit(0);
}

if (!entries.includes("init.mp4")) {
  fail("init.mp4 is missing");
}

if (!entries.includes("internal.m3u8")) {
  fail("internal.m3u8 is missing");
}

if (segments.length < 2) {
  fail("at least two media segments are required");
}

for (let index = 1; index < segments.length; index += 1) {
  const previous = segments[index - 1].sequence;
  const current = segments[index].sequence;
  if (current !== previous + 1) {
    fail(`segment sequence gap: ${previous} -> ${current}`);
  }
}

for (const file of [initPath, ...segments.map((segment) => join(mediaDir, segment.name))]) {
  const size = statSync(file).size;
  if (size <= 0) {
    fail(`empty media file: ${file}`);
  }
}

const probe = JSON.parse(
  run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_name,codec_type,profile,level,pix_fmt,sample_rate,channels",
    "-of",
    "json",
    initPath,
  ]),
);

const video = probe.streams?.find((stream) => stream.codec_type === "video");
const audio = probe.streams?.find((stream) => stream.codec_type === "audio");

if (video?.codec_name !== "h264") {
  fail(`expected h264 video, got ${video?.codec_name ?? "none"}`);
}

if (video.pix_fmt !== undefined && video.pix_fmt !== "yuv420p") {
  fail(`expected yuv420p video, got ${video.pix_fmt ?? "none"}`);
}

if (audio?.codec_name !== "aac") {
  fail(`expected aac audio, got ${audio?.codec_name ?? "none"}`);
}

if (String(audio.sample_rate) !== "48000") {
  fail(`expected 48000Hz audio, got ${audio.sample_rate ?? "none"}`);
}

if (Number(audio.channels) !== 2) {
  fail(`expected stereo audio, got ${audio.channels ?? "none"} channels`);
}

console.log(
  `verify-segments: ok init=1 segments=${segments.length} oldest=${segments[0].sequence} latest=${
    segments.at(-1).sequence
  }`,
);
