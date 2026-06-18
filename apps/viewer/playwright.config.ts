import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../test-results/viewer",
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    ignoreHTTPSErrors: true,
    launchOptions: {
      args: [
        "--ignore-certificate-errors",
        "--enable-features=WebTransportDeveloperMode",
      ],
    },
  },
});
