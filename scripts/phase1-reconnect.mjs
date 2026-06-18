import { statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const initPath = join(root, "media", "live", "init.mp4");

function runSmoke(label) {
  const result = spawnSync("node", ["scripts/phase1-smoke.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PHASE1_SMOKE_SECONDS: "12",
      PHASE1_MIN_SEGMENTS: "5",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }

  return statSync(initPath).mtimeMs;
}

const firstInitMtime = runSmoke("first ingest");
const secondInitMtime = runSmoke("reconnected ingest");

if (secondInitMtime <= firstInitMtime) {
  throw new Error("reconnected ingest did not generate a newer init.mp4");
}

console.log("phase1-reconnect: ok new init segment generated after caller reconnect");
