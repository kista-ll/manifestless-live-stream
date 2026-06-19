import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const python = process.env.PYTHON ?? "C:/Users/y-aka/AppData/Local/Programs/Python/Python313/python.exe";
const npm = process.env.NPM ?? "C:/Program Files/nodejs/npm.cmd";
const pidDir = resolve(root, "tmp/pids");
const mediaDir = resolve(root, "media/live");
const children = [];
let certHash = "";
let shuttingDown = false;

mkdirSync(pidDir, { recursive: true });

function writePid(name, child) {
  if (child.pid !== undefined) {
    writeFileSync(resolve(pidDir, `${name}.pid`), String(child.pid));
  }
}

function commandForShell(command, args) {
  if (command.endsWith(".cmd")) {
    return { command: "cmd.exe", args: ["/c", command, ...args] };
  }
  return { command, args };
}

function spawnLogged(command, args, name) {
  const shellCommand = commandForShell(command, args);
  const child = spawn(shellCommand.command, shellCommand.args, {
    cwd: root,
    env: {
      ...process.env,
      MLSP_ROOT: root,
      MEDIA_DIR: mediaDir,
      PYTHONPATH: resolve(root, "apps/server/src"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  writePid(name, child);
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    if (name === "server") {
      const match = /WT_READY certHash=(\S+)/.exec(text);
      if (match !== null) {
        certHash = match[1];
      }
    }
    process.stdout.write(`[${name}] ${text}`);
  });
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk.toString()}`));
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.log(`[${name}] exited code=${code ?? ""} signal=${signal ?? ""}`);
      stopAll(1);
    }
  });
  return child;
}

function stopTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

function stopAll(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of [...children].reverse()) {
    if (child.pid !== undefined && child.exitCode === null) {
      stopTree(child.pid);
    }
  }
  rmSync(resolve(pidDir, "server.pid"), { force: true });
  rmSync(resolve(pidDir, "viewer.pid"), { force: true });
  rmSync(resolve(pidDir, "segmenter.pid"), { force: true });
  process.exit(exitCode);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function cleanMedia() {
  mkdirSync(mediaDir, { recursive: true });
  for (const name of readdirSync(mediaDir)) {
    if (name === ".gitkeep") {
      continue;
    }
    rmSync(resolve(mediaDir, name), { force: true });
  }
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  process.on("SIGINT", () => stopAll(0));
  process.on("SIGTERM", () => stopAll(0));
  cleanMedia();

  spawnLogged(python, ["-m", "manifestless_server.e2e_server"], "server");
  await waitFor(() => certHash !== "", 15000, "WebTransport server");

  spawnLogged(
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

  spawnLogged(npm, ["--prefix", "apps/viewer", "run", "dev", "--", "--host", "127.0.0.1"], "viewer");
  await delay(1000);

  const wtUrl = "https://localhost:4433/webtransport/live-001";
  const viewerUrl = `http://127.0.0.1:5173/?wt=${encodeURIComponent(wtUrl)}&certHash=${encodeURIComponent(certHash)}`;
  console.log("");
  console.log("READY");
  console.log(`Viewer: ${viewerUrl}`);
  console.log("API: http://127.0.0.1:8000/api/health");
  console.log("Ingest API: http://127.0.0.1:8000/api/ingest");
  console.log("Stream API: http://127.0.0.1:8000/api/stream");
  console.log(`WebTransport: ${wtUrl}`);
  console.log("SRT Listener: srt://127.0.0.1:9000?mode=caller&latency=200000");
  console.log("");
  console.log("Run `make stream-start` in another PowerShell to start the test encoder.");
  console.log("Use Ctrl+C here or `make stop` in another PowerShell to stop everything.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  stopAll(1);
});
