import {expect, test} from "@playwright/test";
import {waitForMap} from "./wait-for-map";

test.describe("eras", () => {
  test.beforeEach(async ({page}) => {
    await page.goto("/?seed=test-eras&width=1280&height=720");
    await waitForMap(page);
  });

  test("generates eras and switches the political layer with the slider", async ({page}) => {
    await page.click("#optionsTrigger");
    await page.click("#toolsTab");
    await page.click("#editErasButton");

    await expect(page.locator("#erasEditor")).toBeVisible();
    await expect(page.locator("#erasPlayback")).toBeHidden();

    await page.fill("#erasCount", "3");
    await page.fill("#erasYears", "100");
    await page.click("#erasGenerate");

    await expect(page.locator("#erasPlayback")).toBeVisible();

    const eraCount = await page.evaluate(() => (window as any).pack.eras.length);
    expect(eraCount).toBe(3);

    const slider = page.locator("#erasSlider");
    await expect(slider).toHaveValue("2");

    const firstYear = await page.locator("#erasYearLabel").textContent();

    await slider.fill("0");
    await slider.dispatchEvent("input");

    const secondYear = await page.locator("#erasYearLabel").textContent();
    expect(secondYear).not.toBe(firstYear);

    const stateForEra0 = await page.evaluate(() => Array.from((window as any).pack.cells.state));
    const erasFromPack = await page.evaluate(() => (window as any).pack.eras[0].cellsState);
    expect(stateForEra0).toEqual(erasFromPack);
  });

  test("shows an error and no playback when no states exist yet", async ({page}) => {
    await page.evaluate(() => {
      const {pack} = window as any;
      pack.states = [{i: 0, name: "Neutrals"}];
    });

    await page.click("#optionsTrigger");
    await page.click("#toolsTab");
    await page.click("#editErasButton");
    await page.click("#erasGenerate");

    await expect(page.locator("#erasPlayback")).toBeHidden();
  });
});
