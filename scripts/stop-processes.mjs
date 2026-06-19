import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const pidDir = resolve(root, "tmp/pids");
const names = process.argv.slice(2);
const selected = names.length === 0 ? ["stream-caller", "segmenter", "viewer", "server"] : names;

function stopPid(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(Number(pid), "SIGTERM");
  } catch {
    // Already stopped.
  }
}

for (const name of selected) {
  const path = resolve(pidDir, `${name}.pid`);
  if (!existsSync(path)) {
    console.log(`${name}: not running`);
    continue;
  }
  const pid = readFileSync(path, "utf8").trim();
  if (pid !== "") {
    stopPid(pid);
  }
  rmSync(path, { force: true });
  console.log(`${name}: stopped`);
}
