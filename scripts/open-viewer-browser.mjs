import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import { resolve } from "node:path";

const root = process.cwd();
const certPath = resolve(root, "certs", "localhost.crt");
const profileDir = resolve(root, "tmp", "chrome-webtransport-profile");

const browserCandidates = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

function certificateHash() {
  if (!existsSync(certPath)) {
    throw new Error("certs/localhost.crt is missing. Run `make bootstrap` or `make run` first.");
  }
  const cert = new X509Certificate(readFileSync(certPath));
  return createHash("sha256").update(cert.raw).digest("base64");
}

function findBrowser() {
  for (const candidate of browserCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Chrome or Edge was not found. Set CHROME=C:/path/to/chrome.exe and retry.");
}

const wtUrl = "https://127.0.0.1:4433/webtransport/live-001";
const viewerUrl = `http://127.0.0.1:5173/?wt=${encodeURIComponent(wtUrl)}&certHash=${encodeURIComponent(certificateHash())}`;
const browser = findBrowser();
mkdirSync(profileDir, { recursive: true });

const args = [
  `--user-data-dir=${profileDir}`,
  "--ignore-certificate-errors",
  "--enable-features=WebTransportDeveloperMode",
  "--origin-to-force-quic-on=127.0.0.1:4433",
  "--autoplay-policy=no-user-gesture-required",
  viewerUrl,
];

const child = spawn(browser, args, {
  detached: true,
  stdio: "ignore",
});
child.unref();

console.log(`Opened: ${viewerUrl}`);
console.log(`Browser: ${browser}`);
console.log(`Profile: ${profileDir}`);
