const { test, expect } = require("@playwright/test");
process.env.NODE_ENV = "test";
const game = require("../../lib/game.js");
const {
  fullyInsideVisualViewport,
  openAnomalyThemePage,
  openHome,
  startAnomaly,
  startOriginalMode,
  submitGuess,
  touchSwipe,
} = require("./helpers.js");

const MOBILE_GUESSES = ["阿米娅", "能天使", "陈", "银灰", "推进之王", "德克萨斯", "蓝毒", "夜莺"];

test.skip(({ isMobile }) => !isMobile, "仅在移动端视口执行");

test.beforeEach(async ({ page }) => {
  await openHome(page);
});

test("模式选择卡片和主入口均不发生横向裁切", async ({ page }) => {
  for (const selector of ["#modeSuddenCard", "#modeEndless", "#modeAnomalyCard"]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    const horizontalGeometry = await page.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport ? viewport.offsetLeft : 0;
      const right = left + (viewport ? viewport.width : window.innerWidth);
      return { left: rect.left, right: rect.right, viewportLeft: left, viewportRight: right };
    });
    expect(horizontalGeometry.left).toBeGreaterThanOrEqual(horizontalGeometry.viewportLeft);
    expect(horizontalGeometry.right).toBeLessThanOrEqual(horizontalGeometry.viewportRight);
  }
});

test("移动端根页面不产生横向滚动", async ({ page }) => {
  const assertRootWidth = async () => {
    const metrics = await page.evaluate(() => ({
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      documentOverflowX: getComputedStyle(document.documentElement).overflowX,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
      offenders: Array.from(document.querySelectorAll("body *")).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: element.id ? "#" + element.id : "." + Array.from(element.classList).join("."),
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
        };
      }).filter((item) => item.left < -1 || item.right > document.documentElement.clientWidth + 1).slice(0, 20),
    }));
    expect(metrics.documentScrollWidth, JSON.stringify(metrics, null, 2)).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
    expect(metrics.bodyScrollWidth, JSON.stringify(metrics, null, 2)).toBeLessThanOrEqual(metrics.bodyClientWidth + 1);
    expect(metrics.documentOverflowX).toBe("hidden");
    expect(metrics.bodyOverflowX).toBe("hidden");
  };

  await assertRootWidth();
  const opened = await startOriginalMode(page, "sudden");
  const session = game._test.decrypt(opened.token);
  const guess = MOBILE_GUESSES.find((name) => name !== session.name);
  await submitGuess(page, guess, 1);
  await assertRootWidth();
});

test("移动端恢复原提交动效，并在原动效结束后横滑到档案", async ({ page }) => {
  const opened = await startOriginalMode(page, "sudden");
  const session = game._test.decrypt(opened.token);
  const guess = MOBILE_GUESSES.find((name) => name !== session.name);
  await submitGuess(page, guess, 1);
  const firstRecord = page.locator("#rows > .guess-card").first();
  const layout = firstRecord.locator(".operator-record-layout");
  await expect(firstRecord).toHaveClass(/is-first-record/);
  const entryStyle = await firstRecord.evaluate((element) => ({
    animationName: getComputedStyle(element).animationName,
    animationDuration: getComputedStyle(element).animationDuration,
    filter: getComputedStyle(element).filter,
    artAnimationName: getComputedStyle(element.querySelector(".operator-art")).animationName,
  }));
  expect(entryStyle.animationName).toContain("guess-card-dock");
  expect(Number.parseFloat(entryStyle.animationDuration)).toBeCloseTo(1.18, 1);
  expect(entryStyle.artAnimationName).toContain("mobile-art-reveal");
  await expect(layout).not.toHaveClass(/mobile-show-record/);
  await expect.poll(() => layout.evaluate((element) => element.classList.contains("mobile-show-record")), {
    timeout: 2_500,
  }).toBe(true);

  const secondGuess = MOBILE_GUESSES.find((name) => name !== session.name && name !== guess);
  await submitGuess(page, secondGuess, 2);
  const secondRecord = page.locator("#rows > .guess-card").first();
  const secondEntryStyle = await secondRecord.evaluate((element) => ({
    animationName: getComputedStyle(element).animationName,
    animationDuration: getComputedStyle(element).animationDuration,
    filter: getComputedStyle(element).filter,
    artAnimationName: getComputedStyle(element.querySelector(".operator-art")).animationName,
    scanAnimation: getComputedStyle(element.querySelector(".operator-visual-scan")).animationName,
  }));
  expect(secondEntryStyle.animationName).toContain("guess-card-dock");
  expect(Number.parseFloat(secondEntryStyle.animationDuration)).toBeCloseTo(1.18, 1);
  expect(secondEntryStyle.artAnimationName).toContain("mobile-art-reveal");
});

test("移动端单条档案下沿紧贴固定输入框；多条档案溢出时不再平移档案区、档案头留在视口顶部", async ({ page }) => {
  const opened = await startOriginalMode(page, "sudden");
  const session = game._test.decrypt(opened.token);
  const guesses = MOBILE_GUESSES.filter((name) => name !== session.name).slice(0, 2);
  const readNewestGeometry = () => page.evaluate(() => {
    const rows = document.getElementById("rows").getBoundingClientRect();
    const card = document.querySelector("#rows > .guess-card:first-child").getBoundingClientRect();
    const consoleRect = document.querySelector(".guess-console").getBoundingClientRect();
    const section = document.querySelector(".dossier-section");
    const head = document.querySelector(".dossier-head").getBoundingClientRect();
    const rowsEl = document.getElementById("rows");
    const viewport = window.visualViewport;
    return {
      consoleGap: consoleRect.top - card.bottom,
      cardTopGap: card.top - rows.top,
      cardFlexBasis: getComputedStyle(document.querySelector("#rows > .guess-card:first-child")).flexBasis,
      rowsTop: rows.top,
      rowsBottom: rows.bottom,
      cardTop: card.top,
      cardBottom: card.bottom,
      consoleTop: consoleRect.top,
      cardOffsetHeight: document.querySelector("#rows > .guess-card:first-child").offsetHeight,
      rowsScrollTop: rowsEl.scrollTop,
      rowsOverflow: rowsEl.scrollHeight > rowsEl.clientHeight + 1,
      sectionShift: section.style.translate || "",
      headTop: head.top - (viewport ? viewport.offsetTop : 0),
      boardBottom: document.getElementById("board").getBoundingClientRect().bottom,
      dossierBottom: document.querySelector(".dossier-section").getBoundingClientRect().bottom,
      workspaceBottom: document.querySelector(".game-workspace").getBoundingClientRect().bottom,
      workspacePaddingBottom: getComputedStyle(document.querySelector(".game-workspace")).paddingBottom,
      consolePosition: getComputedStyle(document.querySelector(".guess-console")).position,
    };
  });

  for (let index = 0; index < guesses.length; index += 1) {
    await submitGuess(page, guesses[index], index + 1);
    await expect(page.locator("#rows > .guess-card").first()).not.toHaveClass(/card-entering/);
    // 锚点校正另有 320ms/1320ms 的延迟帧（等待立绘加载），等待其全部落定后再读几何
    await page.waitForTimeout(1_500);
    const geometry = await readNewestGeometry();
    expect(geometry.cardTopGap, "guess " + (index + 1) + ": " + JSON.stringify(geometry)).toBeLessThanOrEqual(16);
    expect(geometry.cardFlexBasis, "guess " + (index + 1) + ": " + JSON.stringify(geometry)).toBe("auto");
    if (geometry.rowsOverflow) {
      // 多条档案已溢出、由列表内部滚动：档案区保持自然槽位（零位移），
      // 档案头不被推出视口上沿，档案上方不出现大片空白。
      // 注：浏览器会把 style.translate="0 0px" 规范序列化为 "0px"，故按数值解析 Y 分量。
      const shiftParts = geometry.sectionShift.split(/\s+/).filter(Boolean);
      const shiftY = Number.parseFloat(shiftParts[1] || "0") || 0;
      expect(shiftY, "guess " + (index + 1) + ": " + JSON.stringify(geometry)).toBe(0);
      expect(geometry.headTop, "guess " + (index + 1) + ": " + JSON.stringify(geometry)).toBeGreaterThanOrEqual(-2);
    } else {
      // 单条短档案未溢出：下沿贴合固定控制台，避免档案与输入框之间出现空洞。
      expect(Math.abs(geometry.consoleGap), "guess " + (index + 1) + ": " + JSON.stringify(geometry)).toBeLessThanOrEqual(4);
    }
  }
});

test("浏览器工具栏持续占位时外层下移，档案区不再被顶栏和输入框挤压", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 560 });
  const opened = await startOriginalMode(page, "sudden");
  const session = game._test.decrypt(opened.token);
  const guess = MOBILE_GUESSES.find((name) => name !== session.name);
  await submitGuess(page, guess, 1);
  const firstRecord = page.locator("#rows > .guess-card").first();
  const layout = firstRecord.locator(".operator-record-layout");
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 2_000 }).toBeGreaterThan(24);
  await expect.poll(() => layout.evaluate((element) => element.classList.contains("mobile-show-record")), {
    timeout: 2_500,
  }).toBe(true);

  const geometry = await page.evaluate(() => {
    const viewport = window.visualViewport;
    const viewportTop = viewport ? viewport.offsetTop : 0;
    const viewportHeight = viewport ? viewport.height : window.innerHeight;
    const gameLayout = document.querySelector("#gameScreen .game-layout").getBoundingClientRect();
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const board = document.getElementById("board").getBoundingClientRect();
    const rowsRect = document.getElementById("rows").getBoundingClientRect();
    const consoleRect = document.querySelector(".guess-console").getBoundingClientRect();
    const cardRect = document.querySelector("#rows > .guess-card:first-child").getBoundingClientRect();
    const clueHeights = Array.from(document.querySelectorAll("#rows > .guess-card:first-child .v2-clue-grid > .clue"))
      .map((element) => element.getBoundingClientRect().height);
    const clippedText = Array.from(document.querySelectorAll("#rows > .guess-card:first-child .clue"))
      .flatMap((clue) => Array.from(clue.querySelectorAll(".clue-label,.clue-value,.clue-hint,.clue-meta"))
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => ({
          clue: clue.getBoundingClientRect(),
          text: element.getBoundingClientRect(),
          className: element.className,
          content: element.textContent.trim(),
        })))
      .filter(({ clue, text }) => text.height > 0 && text.bottom > clue.bottom + 1)
      .map(({ className, content }) => ({ className, content }));
    return {
      viewportTop,
      viewportHeight,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      activeElement: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
      gameTop: gameLayout.top,
      gameBottom: gameLayout.bottom,
      gameHeight: gameLayout.height,
      topbarBottom: topbar.bottom,
      boardHeight: board.height,
      cardHeight: cardRect.height,
      cardTopGap: cardRect.top - rowsRect.top,
      cardBottomGap: rowsRect.bottom - cardRect.bottom,
      maxClueHeight: Math.max(0, ...clueHeights),
      cardConsoleGap: consoleRect.top - cardRect.bottom,
      consoleBottom: consoleRect.bottom,
      clippedText,
      transitionProperty: getComputedStyle(document.querySelector(".guess-console")).transitionProperty,
    };
  });
  expect(geometry.gameTop, JSON.stringify(geometry, null, 2)).toBeLessThan(geometry.viewportTop - 24);
  expect(Math.abs(geometry.gameBottom - geometry.viewportTop - geometry.viewportHeight), JSON.stringify(geometry, null, 2)).toBeLessThanOrEqual(8);
  expect(geometry.gameHeight).toBeGreaterThan(geometry.viewportHeight + 24);
  expect(geometry.topbarBottom).toBeLessThanOrEqual(geometry.viewportTop + 2);
  expect(geometry.consoleBottom).toBeLessThanOrEqual(geometry.viewportTop + geometry.viewportHeight + 3);
  expect(geometry.boardHeight).toBeGreaterThan(420);
  expect(geometry.cardHeight, JSON.stringify(geometry, null, 2)).toBeLessThan(540);
  expect(Math.abs(geometry.cardConsoleGap), JSON.stringify(geometry, null, 2)).toBeLessThanOrEqual(4);
  expect(geometry.maxClueHeight, JSON.stringify(geometry, null, 2)).toBeLessThanOrEqual(84);
  expect(geometry.clippedText, JSON.stringify(geometry.clippedText, null, 2)).toHaveLength(0);
  expect(geometry.transitionProperty).not.toContain("transform");
  expect(geometry.transitionProperty).not.toContain("max-height");

  await page.locator("#guessInput").focus();
  await expect(page.locator("#guessInput")).toHaveCSS("box-shadow", "none");
  await expect(page.locator("body")).toHaveClass(/mobile-guess-docked/);
  const dockBefore = await page.evaluate(() => {
    const viewport = window.visualViewport;
    const viewportTop = viewport ? viewport.offsetTop : 0;
    const viewportBottom = viewportTop + (viewport ? viewport.height : window.innerHeight);
    const consoleRect = document.querySelector(".guess-console").getBoundingClientRect();
    const cardRect = document.querySelector("#rows > .guess-card:first-child").getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      viewOffsetY: window.scrollY + viewportTop,
      consoleTop: consoleRect.top,
      consoleBottomGap: viewportBottom - consoleRect.bottom,
      cardTop: cardRect.top,
      cardVisualTop: cardRect.top - viewportTop,
      position: getComputedStyle(document.querySelector(".guess-console")).position,
      consoleZIndex: Number.parseInt(getComputedStyle(document.querySelector(".guess-console")).zIndex, 10) || 0,
      cardZIndex: Number.parseInt(getComputedStyle(document.querySelector("#rows > .guess-card:first-child")).zIndex, 10) || 0,
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
  const dockAfter = await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const viewport = window.visualViewport;
      const viewportTop = viewport ? viewport.offsetTop : 0;
      const viewportBottom = viewportTop + (viewport ? viewport.height : window.innerHeight);
      const consoleRect = document.querySelector(".guess-console").getBoundingClientRect();
      const cardRect = document.querySelector("#rows > .guess-card:first-child").getBoundingClientRect();
      resolve({
        scrollY: window.scrollY,
        viewOffsetY: window.scrollY + viewportTop,
        consoleTop: consoleRect.top,
        consoleBottomGap: viewportBottom - consoleRect.bottom,
        cardTop: cardRect.top,
        cardVisualTop: cardRect.top - viewportTop,
        cardBottom: cardRect.bottom,
        consoleLayerTop: consoleRect.top,
      });
    }));
  }));
  expect(dockBefore.position).toBe("fixed");
  expect(Math.abs(dockBefore.consoleBottomGap)).toBeLessThanOrEqual(2);
  expect(Math.abs(dockAfter.consoleBottomGap)).toBeLessThanOrEqual(2);
  expect(Math.abs(dockAfter.consoleTop - dockBefore.consoleTop)).toBeLessThanOrEqual(2);
  const outerScrollDelta = dockAfter.viewOffsetY - dockBefore.viewOffsetY;
  const cardTopDelta = dockAfter.cardVisualTop - dockBefore.cardVisualTop;
  expect(Math.abs(outerScrollDelta)).toBeGreaterThan(12);
  expect(Math.abs(cardTopDelta)).toBeGreaterThan(12);
  expect(Math.abs(cardTopDelta + outerScrollDelta)).toBeLessThanOrEqual(3);
  expect(dockBefore.consoleZIndex).toBeGreaterThan(dockBefore.cardZIndex);

  await page.locator("#guessInput").evaluate((element) => element.blur());
  await expect(page.locator("body")).toHaveClass(/mobile-guess-docked/);
  await page.locator("#rows").evaluate((element) => { element.scrollTop = 0; });
  const outerScrollBefore = await page.evaluate(() => window.scrollY);
  const layoutBox = await layout.boundingBox();
  expect(layoutBox).toBeTruthy();
  await touchSwipe(page, {
    x: layoutBox.x + layoutBox.width / 2,
    y: Math.max(20, layoutBox.y + layoutBox.height * .3),
  }, {
    x: layoutBox.x + layoutBox.width / 2,
    y: Math.min(540, layoutBox.y + layoutBox.height * .72),
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(outerScrollBefore - 12);
});

test("第一次提交后主输入框在档案内层和页面外层滚动时始终固定最低", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 560 });
  const opened = await startOriginalMode(page, "sudden");
  const session = game._test.decrypt(opened.token);
  const guesses = MOBILE_GUESSES.filter((name) => name !== session.name).slice(0, 2);
  await submitGuess(page, guesses[0], 1);
  await submitGuess(page, guesses[1], 2);

  const inputLocator = page.locator("#guessInput");
  await expect(page.locator("body")).toHaveClass(/mobile-guess-docked/);
  await inputLocator.focus();
  await expect(page.locator("body")).toHaveClass(/mobile-guess-docked/);

  const readGeometry = () => page.evaluate(() => {
    const viewport = window.visualViewport;
    const viewportTop = viewport ? viewport.offsetTop : 0;
    const viewportBottom = viewportTop + (viewport ? viewport.height : window.innerHeight);
    const consoleRect = document.querySelector(".guess-console").getBoundingClientRect();
    const rows = document.getElementById("rows");
    return {
      consoleVisualTop: consoleRect.top - viewportTop,
      consoleBottomGap: viewportBottom - consoleRect.bottom,
      position: getComputedStyle(document.querySelector(".guess-console")).position,
      rowsScrollTop: rows.scrollTop,
      rowsMaxScroll: rows.scrollHeight - rows.clientHeight,
      viewOffsetY: window.scrollY + viewportTop,
    };
  });

  const initial = await readGeometry();
  expect(initial.position).toBe("fixed");
  expect(Math.abs(initial.consoleBottomGap)).toBeLessThanOrEqual(2);
  expect(initial.rowsMaxScroll).toBeGreaterThan(40);

  const rowsBox = await page.locator("#rows").boundingBox();
  expect(rowsBox).toBeTruthy();
  await touchSwipe(page, {
    x: rowsBox.x + rowsBox.width / 2,
    y: rowsBox.y + rowsBox.height * .78,
  }, {
    x: rowsBox.x + rowsBox.width / 2,
    y: rowsBox.y + rowsBox.height * .22,
  });
  await expect.poll(() => page.locator("#rows").evaluate((element) => element.scrollTop), { timeout: 2_000 }).toBeGreaterThan(30);
  const innerDown = await readGeometry();
  expect(innerDown.rowsScrollTop).toBeGreaterThan(30);
  expect(Math.abs(innerDown.consoleVisualTop - initial.consoleVisualTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(innerDown.consoleBottomGap)).toBeLessThanOrEqual(2);

  await touchSwipe(page, {
    x: rowsBox.x + rowsBox.width / 2,
    y: rowsBox.y + rowsBox.height * .22,
  }, {
    x: rowsBox.x + rowsBox.width / 2,
    y: rowsBox.y + rowsBox.height * .78,
  });
  await expect.poll(() => page.locator("#rows").evaluate((element) => element.scrollTop), { timeout: 2_000 })
    .toBeLessThan(innerDown.rowsScrollTop - 30);
  const innerUp = await readGeometry();
  expect(innerUp.rowsScrollTop).toBeLessThan(innerDown.rowsScrollTop - 30);
  expect(Math.abs(innerUp.consoleVisualTop - initial.consoleVisualTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(innerUp.consoleBottomGap)).toBeLessThanOrEqual(2);

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
  const outer = await readGeometry();
  expect(Math.abs(outer.viewOffsetY - initial.viewOffsetY)).toBeGreaterThan(12);
  expect(Math.abs(outer.consoleVisualTop - initial.consoleVisualTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(outer.consoleBottomGap)).toBeLessThanOrEqual(2);

  await inputLocator.evaluate((element) => element.blur());
  await expect(page.locator("body")).toHaveClass(/mobile-guess-docked/);
});

test("移动端立绘预览支持双指缩放，再点图像直接返回", async ({ page }) => {
  const opened = await startOriginalMode(page, "sudden");
  const session = game._test.decrypt(opened.token);
  const guess = MOBILE_GUESSES.find((name) => name !== session.name);
  await submitGuess(page, guess, 1);
  const firstRecord = page.locator("#rows > .guess-card").first();
  await firstRecord.locator('.mobile-record-pager button[aria-label="显示立绘"]').click();
  await firstRecord.locator(".operator-visual.art-preview-trigger").click();
  await expect(page.locator("#artPreview")).toBeVisible();
  await expect(page.locator("#artPreviewMeta")).toContainText("双指缩放");
  // 初始未放大
  expect(await page.locator("#artPreview").evaluate((el) => el.dataset.zoomed)).toBe("false");
  const canvasBox = await page.locator(".art-preview-canvas").boundingBox();
  expect(canvasBox).toBeTruthy();
  const cx = canvasBox.x + canvasBox.width / 2, cy = canvasBox.y + canvasBox.height / 2;
  // 双指捏合张开 → 放大
  const client = await page.context().newCDPSession(page);
  const mk = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: mk(70) });
  for (let i = 1; i <= 6; i += 1) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: mk(70 + 150 * i / 6) });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
  await expect.poll(() => page.locator("#artPreview").evaluate((el) => el.dataset.zoomed)).toBe("true");
  // 捏合结束稍等后，点击图像仍可关闭
  await page.waitForTimeout(420);
  await page.touchscreen.tap(cx, cy);
  await expect(page.locator("#artPreview")).toBeHidden();
});

test("终局校验首次进入时主要猜测输入位于首屏", async ({ page }) => {
  await startOriginalMode(page, "sudden");
  expect(await fullyInsideVisualViewport(page.locator("#guessInput"))).toBe(true);
  expect(await fullyInsideVisualViewport(page.locator("#guessBtn"))).toBe(true);
});

test("异类审查题目装载后至少一张候选卡位于首屏", async ({ page }) => {
  await openAnomalyThemePage(page);
  await startAnomaly(page, "mixed");
  expect(await fullyInsideVisualViewport(page.locator(".anomaly-option").first())).toBe(true);
});

test("移动端揭晓确认弹窗的操作按钮完整可见", async ({ page }) => {
  await startOriginalMode(page, "endless");
  await page.locator("#revealBtn").click();
  await expect(page.locator("#revealModal")).toBeVisible();
  expect(await fullyInsideVisualViewport(page.locator("#revealCancel"))).toBe(true);
  expect(await fullyInsideVisualViewport(page.locator("#revealConfirm"))).toBe(true);
});

test("技能范围在档案中保持紧凑，并可展开查看全部技能", async ({ page }) => {
  const opened = await startOriginalMode(page, "sudden");
  const session = game._test.decrypt(opened.token);
  const guess = MOBILE_GUESSES.find((name) => name !== session.name);
  await submitGuess(page, guess, 1);
  const rangeClue = page.locator("#rows > .guess-card").first().locator(".range-clue");
  await expect(rangeClue.locator(".mobile-range-summary")).toBeVisible();
  await expect(rangeClue.locator(".mobile-range-open")).toBeVisible();
  await expect(rangeClue.locator(".mobile-range-open")).toHaveText("展开完整范围");
  await expect(rangeClue.locator(".range-wrap")).toBeHidden();
  const compactRangeButton = await rangeClue.locator(".mobile-range-open").boundingBox();
  expect(compactRangeButton).toBeTruthy();
  expect(compactRangeButton.height).toBeLessThanOrEqual(15);
  await rangeClue.locator(".mobile-range-open").click();
  await expect(page.locator('#mobileDataSheet[data-kind="range"]')).toBeVisible();
  await expect(page.locator("#mobileDataSheet .mobile-range-detail .skill-range-item")).toHaveCount(
    await rangeClue.locator(".skill-range-item").count()
  );
  const rangeSheetGeometry = await page.locator("#mobileDataSheet").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    return {
      width: rect.width,
      viewportWidth: viewport ? viewport.width : window.innerWidth,
      left: rect.left,
      viewportLeft: viewport ? viewport.offsetLeft : 0,
    };
  });
  expect(rangeSheetGeometry.width).toBeCloseTo(rangeSheetGeometry.viewportWidth, 0);
  expect(rangeSheetGeometry.left).toBeCloseTo(rangeSheetGeometry.viewportLeft, 0);
  const rangeCloseBox = await page.locator("#mobileDataSheetClose").boundingBox();
  expect(rangeCloseBox).toBeTruthy();
  expect(rangeCloseBox.width).toBeLessThanOrEqual(64);
  await page.locator("#mobileDataSheetClose").click();
  await expect(page.locator("#mobileDataSheet")).toBeHidden();
});

test("剪影情报使用独立详情层，放大预览位于最前并可直接关闭", async ({ page }) => {
  test.setTimeout(45_000);
  await page.route("**/api/new?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const url = new URL(route.request().url());
    if (url.searchParams.get("mode") === "sudden") {
      const session = game._test.decrypt(data.token);
      session.cluePlan = {
        ...session.cluePlan,
        id: "e2e-mobile-silhouette",
        kind: "silhouette",
      };
      data.token = game._test.encrypt(session);
    }
    await route.fulfill({ response, json: data });
  });
  const opened = await startOriginalMode(page, "sudden");
  const session = game._test.decrypt(opened.token);
  const matchingNames = Object.values(game._test.data)
    .filter((operator) => operator.name !== session.name && game._test.directiveMatches(session.themeId, operator))
    .map((operator) => operator.name)
    .slice(0, session.themeGoal);
  expect(matchingNames).toHaveLength(session.themeGoal);

  for (let index = 0; index < matchingNames.length; index += 1) {
    const isUnlockingGuess = index === matchingNames.length - 1;
    const clueResponse = isUnlockingGuess
      ? page.waitForResponse((response) => new URL(response.url()).pathname === "/api/clue")
      : null;
    await submitGuess(page, matchingNames[index], index + 1);
    if (clueResponse) await clueResponse;
  }

  await expect(page.locator('#mobileDataSheet[data-kind="intel"]')).toBeVisible();
  await expect(page.locator("#mobileDataSheet .intel-card")).toBeVisible();
  await expect(page.locator("#intelRail")).toBeHidden();
  expect(await page.locator("#rows").evaluate((element) => element.clientHeight)).toBeGreaterThan(240);
  const intelCloseBox = await page.locator("#mobileDataSheetClose").boundingBox();
  expect(intelCloseBox).toBeTruthy();
  expect(intelCloseBox.width).toBeLessThanOrEqual(64);
  await page.locator("#mobileDataSheetClose").click();
  await expect(page.locator("#mobileDirectiveDecodeBtn")).toBeVisible();
  await expect(page.locator("#mobileDirectiveDecodeBtn")).toHaveText("查看情报");
  await page.locator("#mobileDirectiveDecodeBtn").click();
  await expect(page.locator('#mobileDataSheet[data-kind="intel"]')).toBeVisible();

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.15 });
  await page.locator("#mobileDataSheet .intel-media-zoom").click();
  await expect(page.locator("#artPreview")).toBeVisible();
  await expect(page.locator('#mobileDataSheet[data-kind="intel"]')).toBeVisible();
  const previewGeometry = await page.locator("#artPreview").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewportLeft: viewport ? viewport.offsetLeft : 0,
      viewportTop: viewport ? viewport.offsetTop : 0,
      viewportWidth: viewport ? viewport.width : window.innerWidth,
      viewportHeight: viewport ? viewport.height : window.innerHeight,
      previewZ: Number(getComputedStyle(element).zIndex),
      sheetZ: Number(getComputedStyle(document.querySelector("#mobileDataSheet")).zIndex),
    };
  });
  expect(previewGeometry.previewZ).toBeGreaterThan(previewGeometry.sheetZ);
  expect(previewGeometry.left).toBeCloseTo(previewGeometry.viewportLeft, 0);
  expect(previewGeometry.top).toBeCloseTo(previewGeometry.viewportTop, 0);
  expect(previewGeometry.width).toBeCloseTo(previewGeometry.viewportWidth, 0);
  expect(previewGeometry.height).toBeCloseTo(previewGeometry.viewportHeight, 0);
  expect(await fullyInsideVisualViewport(page.locator("#artPreviewClose"))).toBe(true);
  await expect(page.locator("#artPreviewMeta")).toContainText("双指缩放");
  // 移动端预览已支持双指缩放：图像变换由 --preview-scale 驱动（初始为矩阵恒等）
  expect(await page.locator("#artPreview").evaluate((el) => el.dataset.zoomed)).toBe("false");
  const canvasBox = await page.locator(".art-preview-canvas").boundingBox();
  expect(canvasBox).toBeTruthy();
  await page.touchscreen.tap(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await expect(page.locator("#artPreview")).toBeHidden();
  await expect(page.locator("#mobileDataSheet")).toBeHidden();
  await client.detach();
});
