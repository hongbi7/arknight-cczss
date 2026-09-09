const { test, expect } = require("@playwright/test");
process.env.NODE_ENV = "test";
const game = require("../../lib/game.js");
const art = require("../../public/data/operator-art.json");
const previews = require("../../public/data/portrait-previews.json");
const { openHome, startOriginalMode, submitGuess, openAnomalyThemePage } = require("./helpers.js");

async function openGuess(page) {
  await openHome(page);
  const opened = await startOriginalMode(page, "endless");
  const answer = game._test.decrypt(opened.token).name;
  const name = answer === "阿米娅" ? "能天使" : "阿米娅";
  const original = art[previews.names[name]].e1;
  return { name, answer, original, preview: previews.images[original] };
}

test("首页装饰和隐藏模式图片继续后台下载，但使用低优先级", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  const requests = new Map();
  client.on("Network.requestWillBeSent", ({ request }) => {
    requests.set(new URL(request.url).pathname, request.initialPriority);
  });
  await openHome(page);
  const rhine = "/img/factions/rhine.webp";
  await expect.poll(() => requests.has(rhine)).toBe(true);
  expect(requests.get(rhine)).toBe("Low");
  await expect(page.locator("#anomalyScreen")).toBeHidden();
  await expect(page.locator("#anomalyScreen .anomaly-rhine img")).toHaveAttribute("fetchpriority", "low");
  await expect(page.locator(".chessmaster-scene img")).toHaveAttribute("fetchpriority", "high");
  await startOriginalMode(page, "endless");
  await expect(page.locator(".chessmaster-scene img")).toHaveAttribute("fetchpriority", "low");
  await client.detach();
});

test("切换模式后忽略旧猜测响应，不再为旧模式提升图片优先级", async ({ page }) => {
  const { name } = await openGuess(page);
  const skin = Object.keys(previews.images).find((url) => url.startsWith("/img/operators/skins/"));
  let release;
  let received = false;
  let staleImages = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === previews.images[skin]) staleImages += 1;
  });
  await page.route("**/api/guess", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.operator.themeArtUrl = skin;
    received = true;
    await gate;
    await route.fulfill({ response, json: data });
  });
  try {
    await page.locator("#guessInput").fill(name);
    await page.locator("#guessBtn").click();
    await expect.poll(() => received).toBe(true);
    await page.locator("#ingameChangeModeBtn").click();
    await expect(page.locator("#modeScreen")).toBeVisible();
    const response = page.waitForResponse((entry) => new URL(entry.url()).pathname === "/api/guess");
    release();
    await (await response).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator("#rows .guess-card")).toHaveCount(0);
    expect(staleImages).toBe(0);
  } finally {
    release();
  }
});

test("当前档案保持高优先级，旧档案在新猜测后降级", async ({ page }) => {
  const { name, answer } = await openGuess(page);
  await submitGuess(page, name, 1);
  const oldImage = page.locator("#rows .operator-art").first();
  await expect(oldImage).toHaveAttribute("fetchpriority", "high");
  const next = ["银灰", "陈", "蓝毒"].find((entry) => entry !== answer && entry !== name);
  await submitGuess(page, next, 2);
  await expect(page.locator("#rows .operator-art").nth(0)).toHaveAttribute("fetchpriority", "high");
  await expect(page.locator("#rows .operator-art").nth(1)).toHaveAttribute("fetchpriority", "low");
});

test("异类审查在转场期间并行预载本题四张时装轻量图，放大保留对应原图", async ({ page }) => {
  await openHome(page);
  await openAnomalyThemePage(page);
  const skins = Object.keys(previews.images).filter((url) => url.startsWith("/img/operators/skins/")).slice(0, 4);
  const counts = new Map();
  let originals = 0;
  page.on("request", (request) => {
    const url = new URL(request.url()).pathname;
    if (skins.includes(url)) originals += 1;
    if (skins.some((source) => previews.images[source] === url)) counts.set(url, (counts.get(url) || 0) + 1);
  });
  await page.route("**/api/anomaly/new?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    // Exercise the public API's explicit skin paths, independent of random theme selection.
    data.question.options = data.question.options.map((option, index) => ({ ...option, imageUrl: skins[index], artKind: "skin" }));
    await route.fulfill({ response, json: data });
  });
  await page.evaluate(() => {
    const original = playWipe;
    playWipe = () => {
      const transition = original();
      return { ...transition, finished: Promise.all([
        transition.finished,
        new Promise((resolve) => { window.releasePortraitTransition = resolve; }),
      ]) };
    };
  });
  try {
    await page.locator("#anomalyThemeStart").click();
    await expect.poll(() => counts.size).toBe(4);
    await expect(page.locator(".anomaly-option:not(.is-skeleton)")).toHaveCount(0);
    expect(originals).toBe(0);
    await page.evaluate(() => window.releasePortraitTransition());
    await expect(page.locator(".anomaly-option:not(.is-skeleton)")).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      const image = page.locator(".anomaly-option-art img").nth(index);
      await expect(image).toHaveAttribute("src", previews.images[skins[index]]);
      await expect(image).toHaveAttribute("fetchpriority", "high");
      await expect(image).toHaveAttribute("loading", "eager");
      expect(counts.get(previews.images[skins[index]])).toBe(1);
    }
    await page.locator(".anomaly-option").first().click();
    await page.locator("#anomalyConfirmBtn").click();
    await expect(page.locator("#anomalyReview")).toBeVisible();
    await page.locator(".anomaly-option").first().evaluate((element) => element.click());
    await expect(page.locator("#artPreviewImage")).toHaveAttribute("src", skins[0]);
    await expect.poll(() => originals).toBe(1);
  } finally {
    await page.evaluate(() => window.releasePortraitTransition?.());
  }
});

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
