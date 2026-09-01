const { expect } = require("@playwright/test");

async function openHome(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#modeScreen")).toBeVisible();
  await expect(page.locator("#modeSuddenCard")).toBeVisible();
}

async function startOriginalMode(page, mode) {
  const selector = mode === "sudden" ? "#modeSuddenCard" : "#modeEndless";
  const newGameResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/new" && url.searchParams.get("mode") === mode;
  });
  await page.locator(selector).click();
  const data = await (await newGameResponse).json();
  await expect(page.locator("#gameScreen")).toBeVisible();
  await expect(page.locator("#guessInput")).toBeVisible();
  return data;
}

async function submitGuess(page, name, expectedCount) {
  const mobileDataSheet = page.locator("#mobileDataSheet:not(.hidden)");
  if (await mobileDataSheet.count() && await mobileDataSheet.isVisible()) {
    await page.locator("#mobileDataSheetClose").click();
    await expect(mobileDataSheet).toHaveCount(0);
  }
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/guess");
  await page.locator("#guessInput").fill(name);
  await page.locator("#guessBtn").click();
  const data = await (await responsePromise).json();
  await expect(page.locator("#rows > .guess-card")).toHaveCount(expectedCount);
  await expect(page.locator("#rows > .guess-card").first().locator(".guess-title h3")).toHaveText(name);
  return data;
}

async function openAnomalyThemePage(page) {
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/anomaly/themes");
  await page.locator("#modeAnomalyCard").click();
  await responsePromise;
  await expect(page.locator("#anomalyThemeSelect")).toBeVisible();
  await expect(page.locator(".anomaly-theme-card")).toHaveCount(7);
}

async function startAnomaly(page, domain = "mixed") {
  await page.locator('.anomaly-theme-card[data-domain="' + domain + '"]').click();
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/anomaly/new");
  await page.locator("#anomalyThemeStart").click();
  await responsePromise;
  await expect(page.locator("#anomalyConsole")).toBeVisible();
  await expect(page.locator(".anomaly-option")).toHaveCount(4);
}

async function fullyInsideVisualViewport(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport ? viewport.offsetLeft : 0;
    const top = viewport ? viewport.offsetTop : 0;
    const right = left + (viewport ? viewport.width : window.innerWidth);
    const bottom = top + (viewport ? viewport.height : window.innerHeight);
    return rect.left >= left && rect.right <= right && rect.top >= top && rect.bottom <= bottom;
  });
}

async function touchSwipe(page, from, to, steps = 8) {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        radiusX: 8,
        radiusY: 8,
        force: 1,
        id: 1,
      }],
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

module.exports = {
  fullyInsideVisualViewport,
  openAnomalyThemePage,
  openHome,
  startAnomaly,
  startOriginalMode,
  submitGuess,
  touchSwipe,
};
