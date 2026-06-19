import { X509Certificate, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import playwright from "../apps/viewer/node_modules/playwright/index.js";

const root = process.cwd();
const certPath = resolve(root, "certs", "localhost.crt");
const { chromium } = playwright;

if (chromium === undefined) {
  throw new Error("Playwright is not available. Run `make bootstrap` first.");
}

function certificateHash() {
  if (!existsSync(certPath)) {
    throw new Error("certs/localhost.crt is missing. Run `make bootstrap` or `make run` first.");
  }
  const cert = new X509Certificate(readFileSync(certPath));
  return createHash("sha256").update(cert.raw).digest("base64");
}

const wtUrl = "https://127.0.0.1:4433/webtransport/live-001";
const viewerUrl = `http://127.0.0.1:5173/?wt=${encodeURIComponent(wtUrl)}&certHash=${encodeURIComponent(certificateHash())}`;

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--ignore-certificate-errors",
    "--enable-quic",
    "--enable-features=WebTransportDeveloperMode",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.goto(viewerUrl);

console.log(`Opened: ${viewerUrl}`);
console.log("This Playwright-launched Chrome window stays open while this command is running.");
console.log("Press Ctrl+C in this PowerShell after you finish checking playback.");

await new Promise(() => undefined);
