const { test, expect } = require("@playwright/test");
process.env.NODE_ENV = "test";
const game = require("../../lib/game.js");
const art = require("../../public/data/operator-art.json");
const previews = require("../../public/data/portrait-previews.json");
const { openHome, startOriginalMode } = require("./helpers.js");

async function openGuess(page) {
  await openHome(page);
  const opened = await startOriginalMode(page, "endless");
  const answer = game._test.decrypt(opened.token).name;
  const name = answer === "阿米娅" ? "能天使" : "阿米娅";
  const original = art[previews.names[name]].e1;
  return { name, original, preview: previews.images[original] };
}

test("提前请求轻量立绘，慢图不阻塞档案，放大才请求原图", async ({ page }, testInfo) => {
  const { name, original, preview } = await openGuess(page);
  let releaseImage;
  let releaseApi;
  const imageGate = new Promise((resolve) => { releaseImage = resolve; });
  const apiGate = new Promise((resolve) => { releaseApi = resolve; });
  let previewRequests = 0;
  let originalRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === original) originalRequests += 1;
  });
  await page.route("**" + preview, async (route) => {
    previewRequests += 1;
    await imageGate;
    await route.continue();
  });
  await page.route("**/api/guess", async (route) => {
    const response = await route.fetch();
    await apiGate;
    await route.fulfill({ response });
  });
  try {
    await page.locator("#guessInput").fill(name);
    await page.locator("#guessBtn").click();
    await expect.poll(() => previewRequests).toBe(1);
    await expect(page.locator("#rows > .guess-card")).toHaveCount(0);
    releaseApi();
    const card = page.locator("#rows > .guess-card").first();
    await expect(card.locator(".guess-title h3")).toHaveText(name);
    await expect(card.locator(".portrait-load-status")).toHaveText("立绘加载中…");
    await expect(page.locator("#guessInput")).toBeEnabled();
    expect(originalRequests).toBe(0);
    releaseImage();
    await expect(card.locator(".portrait-load-status")).toHaveCount(0);
    const image = card.locator(".operator-art");
    await expect(image).toHaveAttribute("loading", "eager");
    await expect(image).toHaveAttribute("fetchpriority", "high");
    await expect(image).toHaveAttribute("src", preview);
    expect(previewRequests).toBe(1);
    await card.screenshot({ path: testInfo.outputPath("lightweight-portrait.png") });
    // Open via its actual handler even if mobile auto-paging is in progress.
    await card.locator(".operator-visual").evaluate((element) => element.click());
    await expect(page.locator("#artPreviewImage")).toHaveAttribute("src", original);
    await expect.poll(() => originalRequests).toBe(1);
  } finally {
    releaseImage();
    releaseApi();
  }
});

for (const failOriginal of [false, true]) {
  test("轻量图失败后回退原图" + (failOriginal ? "，双重失败仍可继续猜测" : ""), async ({ page }) => {
    const { name, original, preview } = await openGuess(page);
    await page.route("**" + preview, (route) => route.abort());
    if (failOriginal) await page.route("**" + original, (route) => route.abort());
    const fallback = page.waitForRequest((request) => new URL(request.url()).pathname === original);
    await page.locator("#guessInput").fill(name);
    await page.locator("#guessBtn").click();
    await fallback;
    const card = page.locator("#rows > .guess-card").first();
    await expect(card.locator(".guess-title h3")).toHaveText(name);
    await expect(page.locator("#guessInput")).toBeEnabled();
    if (failOriginal) {
      await expect(card.locator(".portrait-load-status")).toHaveText("立绘暂时无法加载");
      await expect(card.locator(".operator-visual")).toHaveClass(/image-missing/);
    } else {
      await expect(card.locator(".portrait-load-status")).toHaveCount(0);
      await expect(card.locator(".operator-art")).toHaveAttribute("src", original);
    }
  });
}
