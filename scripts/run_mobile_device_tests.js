const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");
process.env.NODE_ENV = "test";
const game = require("../lib/game.js");

const ADB_PATH = process.env.ADB_PATH || "adb";
const ADB_SERIAL = process.env.ADB_SERIAL || "";
const CDP_PORT = Number(process.env.MOBILE_CDP_PORT) || 9222;
const TEST_URL = process.env.MOBILE_TEST_URL;
const STRICT = process.env.MOBILE_STRICT === "1";
const OUTPUT_DIR = path.join(process.cwd(), "output", "playwright", "device");

if (!TEST_URL) {
  console.error("缺少 MOBILE_TEST_URL，例如 http://192.168.1.20:3300/");
  process.exit(2);
}

function adb(...args) {
  const serialArgs = ADB_SERIAL ? ["-s", ADB_SERIAL] : [];
  const result = spawnSync(ADB_PATH, [...serialArgs, ...args], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error("ADB 执行失败：" + (result.error ? result.error.message : result.stderr.trim()));
  }
  return result.stdout.trim();
}

async function visualGeometry(page, selector) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportRect = {
      left: viewport ? viewport.offsetLeft : 0,
      top: viewport ? viewport.offsetTop : 0,
      right: viewport ? viewport.offsetLeft + viewport.width : window.innerWidth,
      bottom: viewport ? viewport.offsetTop + viewport.height : window.innerHeight,
      width: viewport ? viewport.width : window.innerWidth,
      height: viewport ? viewport.height : window.innerHeight,
    };
    const elementRect = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
    return {
      element: elementRect,
      viewport: viewportRect,
      fullyVisible: elementRect.left >= viewportRect.left
        && elementRect.right <= viewportRect.right
        && elementRect.top >= viewportRect.top
        && elementRect.bottom <= viewportRect.bottom,
    };
  });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  adb("forward", "tcp:" + CDP_PORT, "localabstract:chrome_devtools_remote");
  const browser = await chromium.connectOverCDP("http://127.0.0.1:" + CDP_PORT);
  const context = browser.contexts()[0];
  if (!context) throw new Error("未找到 Android Chrome 上下文");
  const page = context.pages()[0];
  if (!page) throw new Error("Android Chrome 至少需要打开一个普通网页标签");
  page.setDefaultTimeout(15_000);

  const checks = [];
  const record = (name, passed, severity, detail) => {
    checks.push({ name, passed: Boolean(passed), severity, detail });
    console.log((passed ? "PASS" : "FIND") + " [" + severity + "] " + name);
  };

  try {
    await page.goto(TEST_URL, { waitUntil: "domcontentloaded" });
    await page.locator("#modeScreen").waitFor({ state: "visible" });

    const modeCards = await page.evaluate(() => {
      const viewport = window.visualViewport;
      const left = viewport ? viewport.offsetLeft : 0;
      const right = left + (viewport ? viewport.width : window.innerWidth);
      return ["#modeSuddenCard", "#modeEndless", "#modeAnomalyCard"].map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { selector, left: rect.left, right: rect.right, visible: rect.left >= left && rect.right <= right };
      });
    });
    record(
      "模式页无可操作内容横向裁切",
      modeCards.every((card) => card.visible),
      "medium",
      modeCards
    );

    const newGameResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/new" && url.searchParams.get("mode") === "sudden";
    });
    await page.locator("#modeSuddenCard").click();
    const opened = await (await newGameResponse).json();
    const session = game._test.decrypt(opened.token);
    const firstGuessName = Object.values(game._test.data)
      .find((operator) => operator.name !== session.name && !game._test.directiveMatches(session.themeId, operator)).name;
    const matchingNames = Object.values(game._test.data)
      .filter((operator) => operator.name !== session.name && game._test.directiveMatches(session.themeId, operator))
      .map((operator) => operator.name)
      .slice(0, session.themeGoal);
    await page.locator("#gameScreen").waitFor({ state: "visible" });
    // 模拟用户只把输入框滚到可操作边缘后立即点击，而不是由自动化居中整个表单。
    await page.locator("#guessInput").evaluate((element) => element.scrollIntoView({ block: "end" }));
    await page.locator("#guessInput").click();
    await page.waitForTimeout(700);
    const keyboardGeometry = await visualGeometry(page, "#guessBtn");
    const keyboardOpened = keyboardGeometry.viewport.height < 600;
    record("点击猜测输入框会唤起软键盘", keyboardOpened, "high", keyboardGeometry);
    record("软键盘弹出后提交按钮仍完整可见", keyboardGeometry.fullyVisible, "high", keyboardGeometry);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "sudden-keyboard.png") });

    adb("shell", "input", "keyevent", "4");
    await page.waitForTimeout(500);
    await page.locator("#guessInput").fill(firstGuessName);
    await page.locator("#guessBtn").click();
    await page.locator("#rows > .guess-card").first().waitFor({ state: "visible" });

    await page.locator("#guessInput").click();
    await page.waitForTimeout(700);
    await page.waitForFunction(() => document.body.classList.contains("mobile-guess-docked"));
    const dockBefore = await page.evaluate(() => {
      const viewport = window.visualViewport;
      const viewportTop = viewport ? viewport.offsetTop : 0;
      const viewportBottom = viewportTop + (viewport ? viewport.height : window.innerHeight);
      const consoleRect = document.querySelector(".guess-console").getBoundingClientRect();
      const cardRect = document.querySelector("#rows > .guess-card:first-child").getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        viewOffsetY: window.scrollY + viewportTop,
        consoleVisualTop: consoleRect.top - viewportTop,
        consoleBottomGap: viewportBottom - consoleRect.bottom,
        cardVisualTop: cardRect.top - viewportTop,
        position: getComputedStyle(document.querySelector(".guess-console")).position,
      };
    });
    await page.evaluate(() => new Promise((resolve) => {
      const initialScrollY = window.scrollY;
      document.documentElement.classList.add("mobile-game-scroll-driving");
      window.scrollTo({ top: initialScrollY + 40, left: 0, behavior: "auto" });
      requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - initialScrollY) < 16) {
          window.scrollTo({ top: Math.max(0, initialScrollY - 40), left: 0, behavior: "auto" });
        }
        requestAnimationFrame(() => {
          document.documentElement.classList.remove("mobile-game-scroll-driving");
          resolve();
        });
      });
    }));
    await page.waitForTimeout(160);
    const dockAfter = await page.evaluate(() => {
      const viewport = window.visualViewport;
      const viewportTop = viewport ? viewport.offsetTop : 0;
      const viewportBottom = viewportTop + (viewport ? viewport.height : window.innerHeight);
      const consoleRect = document.querySelector(".guess-console").getBoundingClientRect();
      const cardRect = document.querySelector("#rows > .guess-card:first-child").getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        viewOffsetY: window.scrollY + viewportTop,
        consoleVisualTop: consoleRect.top - viewportTop,
        consoleBottomGap: viewportBottom - consoleRect.bottom,
        cardVisualTop: cardRect.top - viewportTop,
        cardBottom: cardRect.bottom,
        consoleTop: consoleRect.top,
      };
    });
    record(
      "输入法打开时输入区固定，档案可继续滚到其后方",
      dockBefore.position === "fixed"
        && Math.abs(dockBefore.consoleBottomGap) <= 3
        && Math.abs(dockAfter.consoleBottomGap) <= 3
        && Math.abs(dockAfter.consoleVisualTop - dockBefore.consoleVisualTop) <= 3
        && Math.abs(dockAfter.viewOffsetY - dockBefore.viewOffsetY) > 12
        && Math.abs(dockAfter.cardVisualTop - dockBefore.cardVisualTop) > 12
        && Math.abs((dockAfter.cardVisualTop - dockBefore.cardVisualTop) + (dockAfter.viewOffsetY - dockBefore.viewOffsetY)) <= 3
        && dockAfter.cardBottom > dockAfter.consoleTop,
      "high",
      { before: dockBefore, after: dockAfter }
    );
    await page.screenshot({ path: path.join(OUTPUT_DIR, "input-docked.png") });
    await page.locator("#guessInput").evaluate((element) => element.blur());
    await page.waitForFunction(() => document.body.classList.contains("mobile-guess-docked"));

    const rangeClue = page.locator("#rows > .guess-card").first().locator(".range-clue");
    const rangeCompact = await rangeClue.evaluate((element) => ({
      summaryVisible: getComputedStyle(element.querySelector(".mobile-range-summary")).display !== "none",
      openVisible: getComputedStyle(element.querySelector(".mobile-range-open")).display !== "none",
      fullHidden: getComputedStyle(element.querySelector(".clue-value")).display === "none",
    }));
    record("技能范围在档案内使用完整的紧凑摘要", rangeCompact.summaryVisible && rangeCompact.openVisible && rangeCompact.fullHidden, "high", rangeCompact);
    await rangeClue.locator(".mobile-range-open").evaluate((element) => element.click());
    await page.locator('#mobileDataSheet[data-kind="range"]').waitFor({ state: "visible" });
    const rangeSheetGeometry = await visualGeometry(page, "#mobileDataSheet");
    const rangeSlotCount = await page.locator("#mobileDataSheet .skill-range-item").count();
    record("完整技能范围在独立详情层内显示且不被裁切", rangeSheetGeometry.fullyVisible && rangeSlotCount > 0, "high", { geometry: rangeSheetGeometry, slots: rangeSlotCount });
    await page.screenshot({ path: path.join(OUTPUT_DIR, "skill-range-sheet.png") });
    await page.locator("#mobileDataSheetClose").evaluate((element) => element.click());

    await page.locator("#rows > .guess-card .operator-visual").first().evaluate((element) => element.click());
    await page.locator("#artPreview").waitFor({ state: "visible" });
    const previewCloseGeometry = await visualGeometry(page, "#artPreviewClose");
    record("立绘大图关闭按钮完整位于可视区", previewCloseGeometry.fullyVisible, "high", previewCloseGeometry);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "art-preview.png") });
    await page.locator("#artPreviewClose").evaluate((element) => element.click());

    await page.locator("#revealBtn").evaluate((element) => element.click());
    await page.locator("#revealModal").waitFor({ state: "visible" });
    const revealCancelGeometry = await visualGeometry(page, "#revealCancel");
    const revealConfirmGeometry = await visualGeometry(page, "#revealConfirm");
    record(
      "揭晓确认弹窗的两个操作按钮完整位于可视区",
      revealCancelGeometry.fullyVisible && revealConfirmGeometry.fullyVisible,
      "high",
      { cancel: revealCancelGeometry, confirm: revealConfirmGeometry }
    );
    await page.screenshot({ path: path.join(OUTPUT_DIR, "reveal-confirm.png") });
    await page.locator("#revealCancel").evaluate((element) => element.click());

    for (let index = 0; index < matchingNames.length; index += 1) {
      const clueResponse = index === matchingNames.length - 1
        ? page.waitForResponse((response) => new URL(response.url()).pathname === "/api/clue")
        : null;
      await page.locator("#guessInput").fill(matchingNames[index]);
      await page.locator("#guessBtn").click();
      await page.locator("#rows > .guess-card").nth(index + 1).waitFor({ state: "attached" });
      if (clueResponse) await clueResponse;
    }
    await page.locator('#mobileDataSheet[data-kind="intel"]').waitFor({ state: "visible" });
    const intelSheetGeometry = await visualGeometry(page, "#mobileDataSheet");
    const intelLayout = await page.evaluate(() => ({
      railHidden: document.getElementById("intelRail").classList.contains("hidden"),
      rowsHeight: document.getElementById("rows").clientHeight,
      reopenVisible: !document.getElementById("mobileDirectiveDecodeBtn").classList.contains("hidden"),
      reopenText: document.getElementById("mobileDirectiveDecodeBtn").textContent.trim(),
    }));
    record(
      "情报奖励使用独立详情层且不压缩档案",
      intelSheetGeometry.fullyVisible && intelLayout.railHidden && intelLayout.rowsHeight > 240 && intelLayout.reopenVisible,
      "high",
      { geometry: intelSheetGeometry, layout: intelLayout }
    );
    await page.screenshot({ path: path.join(OUTPUT_DIR, "intel-sheet.png") });
    await page.locator("#mobileDataSheetClose").evaluate((element) => element.click());

    await page.locator("#ingameChangeModeBtn").evaluate((element) => element.click());
    await page.locator("#modeScreen").waitFor({ state: "visible" });
    await page.locator("#modeAnomalyCard").click();
    await page.locator("#anomalyThemeSelect").waitFor({ state: "visible" });
    await page.locator('.anomaly-theme-card[data-domain="mixed"]').click();
    await page.locator("#anomalyThemeStart").click();
    await page.locator(".anomaly-option").first().waitFor({ state: "visible" });
    // 扫描器位于选项下方；保持它贴近视口底部，模拟自然向下浏览后的点击位置。
    await page.locator("#anomalyScanBtn").evaluate((element) => element.scrollIntoView({ block: "end" }));
    await page.locator("#anomalyScanBtn").click();
    await page.locator("#anomalyHint").waitFor({ state: "visible" });
    const scannerGeometry = await visualGeometry(page, "#anomalyHint");
    record("扫描结果触发后完整位于当前可视区", scannerGeometry.fullyVisible, "high", scannerGeometry);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "anomaly-scanner.png") });
  } finally {
    const report = {
      generatedAt: new Date().toISOString(),
      url: TEST_URL,
      adbSerial: ADB_SERIAL || "default",
      strict: STRICT,
      checks,
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2) + "\n");
    await browser.close();
  }

  const findings = checks.filter((check) => !check.passed);
  console.log("真机检查完成：" + (checks.length - findings.length) + " 通过，" + findings.length + " 项发现。");
  if (STRICT && findings.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
