import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../test-results/viewer",
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    ignoreHTTPSErrors: true,
  },
});
