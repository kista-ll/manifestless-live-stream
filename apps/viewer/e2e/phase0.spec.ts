import { expect, test } from "@playwright/test";

test("phase0 placeholder", async ({ page }) => {
  await page.setContent("<main>Manifestless Live Viewer</main>");
  await expect(page.locator("main")).toContainText("Manifestless");
});
