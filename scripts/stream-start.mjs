import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const pidDir = resolve(root, "tmp/pids");
mkdirSync(pidDir, { recursive: true });

const durationArgs =
  process.env.STREAM_DURATION_SECONDS === undefined || process.env.STREAM_DURATION_SECONDS === ""
    ? []
    : ["-t", process.env.STREAM_DURATION_SECONDS];

const args = [
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
  ...durationArgs,
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
];

const child = spawn("ffmpeg", args, {
  cwd: root,
  stdio: "inherit",
});

const pidPath = resolve(pidDir, "stream-caller.pid");

if (child.pid !== undefined) {
  writeFileSync(pidPath, String(child.pid));
  console.log(`stream caller pid: ${child.pid}`);
}

child.on("exit", (code) => {
  rmSync(pidPath, { force: true });
  process.exit(code ?? 0);
});
