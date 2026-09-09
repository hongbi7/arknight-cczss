const { test, expect } = require("@playwright/test");
process.env.NODE_ENV = "test";
const game = require("../../lib/game.js");
const {
  openHome,
  startOriginalMode,
  submitGuess,
  touchSwipe,
} = require("./helpers.js");

const SAFE_GUESSES = ["阿米娅", "能天使", "陈", "银灰", "推进之王", "德克萨斯", "蓝毒", "夜莺"];

async function expectMobileFinalCardBottomFocus(page) {
  await expect.poll(() => page.evaluate(() => {
    const viewport = window.visualViewport;
    const viewportBottom = (viewport ? viewport.offsetTop : 0)
      + (viewport ? viewport.height : window.innerHeight);
    const finalCard = document.querySelector("#rows > .guess-card.is-final-record").getBoundingClientRect();
    const bottomGap = viewportBottom - finalCard.bottom;
    return bottomGap >= 0 && bottomGap <= 10;
  }), { timeout: 5_000 }).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await openHome(page);
});

test("终局校验：六次猜测、错误四选一、错项档案与终局档案完整落位", async ({ page }, testInfo) => {
  const opened = await startOriginalMode(page, "sudden");
  const session = game._test.decrypt(opened.token);
  expect(session).toBeTruthy();
  const answerName = session.name;
  const guesses = SAFE_GUESSES.filter((name) => name !== answerName).slice(0, 6);

  for (let index = 0; index < guesses.length; index += 1) {
    const isLast = index === guesses.length - 1;
    const choicesResponse = isLast
      ? page.waitForResponse((response) => new URL(response.url()).pathname === "/api/choices")
      : null;
    const guessData = await submitGuess(page, guesses[index], index + 1);
    // Directive rewards may finish their delayed presentation between two
    // submissions. Close the optional mobile sheet before the next iteration
    // so it cannot intercept the submit button mid-click.
    const mobileDataSheet = page.locator("#mobileDataSheet:not(.hidden)");
    const unlockedIntel = Boolean(
      guessData.themeResult
      && guessData.themeResult.newlyCompleted
      && Array.isArray(guessData.pendingClues)
      && guessData.pendingClues.length
    );
    if (unlockedIntel && testInfo.project.name === "mobile-chromium") {
      await expect(mobileDataSheet).toBeVisible();
    } else {
      await page.waitForTimeout(450);
    }
    if (await mobileDataSheet.count() && await mobileDataSheet.isVisible()) {
      await page.locator("#mobileDataSheetClose").click();
      await expect(mobileDataSheet).toHaveCount(0);
    }
    if (choicesResponse) await choicesResponse;
  }

  await expect(page.locator("#choiceModal")).toBeVisible();
  await expect(page.locator(".choice-btn")).toHaveCount(4);
  const optionNames = await page.locator(".choice-btn .choice-info strong").allTextContents();
  const wrongIndex = optionNames.findIndex((name) => name.trim() !== answerName);
  expect(wrongIndex).toBeGreaterThanOrEqual(0);
  const wrongName = optionNames[wrongIndex].trim();

  const pickResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/pick");
  await page.locator(".choice-btn").nth(wrongIndex).evaluate((element) => element.click());
  await pickResponse;

  await expect(page.locator("#choiceModal")).toBeHidden();
  await expect(page.locator("#gameScreen")).toHaveClass(/is-finished/);
  const finalRecord = page.locator("#rows > .guess-card.is-final-record");
  await expect(finalRecord.locator(".guess-title h3")).toHaveText(answerName);
  expect(await finalRecord.evaluate((element) => getComputedStyle(element).animationName)).toContain("final-archive-in");
  const wrongRecord = page.locator("#rows > .guess-card:not(.is-final-record)", {
    has: page.locator(".guess-title h3", { hasText: wrongName }),
  });
  await expect(wrongRecord).toBeVisible();
  await expect(wrongRecord).not.toHaveClass(/card-entering|choice-mistake-record/);
  expect(await wrongRecord.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await expect(wrongRecord.locator(".guess-title small")).toHaveText("OPERATOR RECORD");
  await expect(page.locator("#rows > .guess-card").first()).toHaveClass(/is-final-record/);
  await expect(page.locator("#victory")).toHaveClass(/fail/);
  await expect(page.locator("#victory")).toContainText("猜错了");

  if (testInfo.project.name === "mobile-chromium") {
    // Mobile completion keeps the compact result prompt content-sized; neither
    // it nor the final/ordinary records should reserve a viewport-sized slot.
    const geometry = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const result = rect("#victory");
      const victory = document.querySelector("#victory > .victory").getBoundingClientRect();
      const final = document.querySelector("#rows > .guess-card.is-final-record");
      const normal = document.querySelector("#rows > .guess-card:not(.is-final-record)");
      return {
        boardHeight: rect("#board").height,
        resultHeight: result.height,
        resultInnerGap: result.height - victory.height,
        resultBottomGap: final.getBoundingClientRect().top - result.bottom,
        finalFlexBasis: getComputedStyle(final).flexBasis,
        normalFlexBasis: getComputedStyle(normal).flexBasis,
      };
    });
    expect(geometry.resultInnerGap, JSON.stringify(geometry)).toBeLessThanOrEqual(2);
    expect(geometry.resultHeight, JSON.stringify(geometry)).toBeLessThan(geometry.boardHeight * .6);
    expect(geometry.resultBottomGap, JSON.stringify(geometry)).toBeLessThanOrEqual(12);
    expect(geometry.finalFlexBasis).toBe("auto");
    expect(geometry.normalFlexBasis).toBe("auto");

    // The final focus starts shortly after the entrance (900 ms), rather than
    // leaving the result prompt on screen for the previous 1.35 s interval.
    await page.waitForTimeout(1_150);
    await expect.poll(() => page.locator("#board").evaluate((element) => element.scrollTop)).toBeGreaterThan(12);
    await expectMobileFinalCardBottomFocus(page);
  }
});

test("无尽模式：连续猜测、移动端档案翻页、纵向档案滑动与主动揭晓", async ({ page }, testInfo) => {
  const opened = await startOriginalMode(page, "endless");
  const session = game._test.decrypt(opened.token);
  const guesses = SAFE_GUESSES.filter((name) => name !== session.name).slice(0, 3);
  await submitGuess(page, guesses[0], 1);
  await submitGuess(page, guesses[1], 2);
  await submitGuess(page, guesses[2], 3);

  if (testInfo.project.name === "mobile-chromium") {
    const newestLayout = page.locator("#rows > .guess-card").first().locator(".operator-record-layout");
    await expect(newestLayout).toHaveClass(/mobile-show-record/);
    const layoutBox = await newestLayout.boundingBox();
    expect(layoutBox).toBeTruthy();
    await touchSwipe(page, {
      x: layoutBox.x + layoutBox.width * 0.24,
      y: layoutBox.y + layoutBox.height * 0.5,
    }, {
      x: layoutBox.x + layoutBox.width * 0.72,
      y: layoutBox.y + layoutBox.height * 0.5,
    });
    await expect(newestLayout).not.toHaveClass(/mobile-show-record/);

    const rows = page.locator("#rows");
    const rowsBox = await rows.boundingBox();
    expect(rowsBox).toBeTruthy();
    const swipeTop = Math.max(rowsBox.y + 18, 24);
    const swipeBottom = Math.min(rowsBox.y + rowsBox.height - 18, 680);
    expect(swipeBottom - swipeTop).toBeGreaterThan(80);
    await touchSwipe(page, {
      x: rowsBox.x + rowsBox.width / 2,
      y: swipeBottom,
    }, {
      x: rowsBox.x + rowsBox.width / 2,
      y: swipeTop,
    });
    await expect.poll(() => rows.evaluate((element) => element.scrollTop)).toBeGreaterThan(20);
  } else {
    const desktopRange = page.locator("#rows > .guess-card").first().locator(".range-clue");
    await expect(desktopRange.locator(".range-wrap")).toBeVisible();
    await expect(desktopRange.locator(".mobile-range-summary")).toBeHidden();
    await expect(desktopRange.locator(".mobile-range-open")).toBeHidden();
    await page.locator("#rows > .guess-card").first().locator(".operator-visual.art-preview-trigger").click();
    await expect(page.locator("#artPreview")).toBeVisible();
    await expect(page.locator("#artPreviewMeta")).toContainText("滚轮缩放");
    await page.locator(".art-preview-canvas").hover();
    await page.mouse.wheel(0, -100);
    await expect(page.locator("#artPreview")).toHaveAttribute("data-zoomed", "true");
    await page.locator(".art-preview-canvas").click();
    await expect(page.locator("#artPreview")).toBeVisible();
    await page.locator(".art-preview-canvas").dblclick();
    await expect(page.locator("#artPreview")).toHaveAttribute("data-zoomed", "false");
    await page.locator("#artPreviewClose").click();
  }

  await page.locator("#revealBtn").click();
  await expect(page.locator("#revealModal")).toBeVisible();
  await expect(page.locator("#revealCancel")).toBeVisible();
  const revealResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/reveal");
  await page.locator("#revealConfirm").click();
  await revealResponse;
  await expect(page.locator("#rows > .guess-card.is-final-record")).toBeVisible();
  await expect(page.locator("#gameScreen")).toHaveClass(/is-finished/);
  await expect(page.locator("#victory")).toContainText("答案是");

  if (testInfo.project.name === "mobile-chromium") {
    const board = page.locator("#board");
    const finalRecord = page.locator("#rows > .guess-card.is-final-record");
    const finalLayout = finalRecord.locator(".operator-record-layout");
    const archive = finalRecord.locator(".final-archive-sheet");
    await expect(finalRecord.locator(":scope > .mobile-record-pager")).toHaveCount(0);
    await expect(finalLayout).not.toHaveClass(/mobile-show-record/);
    const initialPages = await finalLayout.evaluate((element) => {
      const visual = element.querySelector(".operator-visual");
      const record = element.querySelector(".operator-record-data");
      const layoutRect = element.getBoundingClientRect();
      const visualRect = visual.getBoundingClientRect();
      const recordRect = record.getBoundingClientRect();
      return {
        display: getComputedStyle(element).display,
        overflowX: getComputedStyle(element).overflowX,
        layoutWidth: layoutRect.width,
        visualWidth: visualRect.width,
        recordWidth: recordRect.width,
        pageOffset: recordRect.left - visualRect.left,
      };
    });
    expect(initialPages.display).toBe("flex");
    expect(initialPages.overflowX).toBe("clip");
    expect(Math.abs(initialPages.visualWidth - initialPages.layoutWidth)).toBeLessThanOrEqual(2);
    expect(Math.abs(initialPages.recordWidth - initialPages.layoutWidth)).toBeLessThanOrEqual(2);
    expect(Math.abs(initialPages.pageOffset - initialPages.layoutWidth)).toBeLessThanOrEqual(2);
    await expect.poll(() => archive.evaluate((element) => getComputedStyle(element).overscrollBehaviorY)).toBe("auto");
    await expectMobileFinalCardBottomFocus(page);
    await page.waitForTimeout(2_800);
    await finalRecord.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const finalLayoutBox = await finalLayout.boundingBox();
    expect(finalLayoutBox).toBeTruthy();
    await touchSwipe(page, {
      x: finalLayoutBox.x + finalLayoutBox.width * 0.78,
      y: finalLayoutBox.y + finalLayoutBox.height * 0.5,
    }, {
      x: finalLayoutBox.x + finalLayoutBox.width * 0.22,
      y: finalLayoutBox.y + finalLayoutBox.height * 0.5,
    });
    await expect(finalLayout).toHaveClass(/mobile-show-record/);
    await expect.poll(() => finalLayout.evaluate((element) => {
      const layoutRect = element.getBoundingClientRect();
      const recordRect = element.querySelector(".operator-record-data").getBoundingClientRect();
      return Math.abs(recordRect.left - layoutRect.left);
    })).toBeLessThanOrEqual(2);
    await touchSwipe(page, {
      x: finalLayoutBox.x + finalLayoutBox.width * 0.22,
      y: finalLayoutBox.y + finalLayoutBox.height * 0.5,
    }, {
      x: finalLayoutBox.x + finalLayoutBox.width * 0.78,
      y: finalLayoutBox.y + finalLayoutBox.height * 0.5,
    });
    await expect(finalLayout).not.toHaveClass(/mobile-show-record/);
    await touchSwipe(page, {
      x: finalLayoutBox.x + finalLayoutBox.width * 0.78,
      y: finalLayoutBox.y + finalLayoutBox.height * 0.5,
    }, {
      x: finalLayoutBox.x + finalLayoutBox.width * 0.22,
      y: finalLayoutBox.y + finalLayoutBox.height * 0.5,
    });
    await expect(finalLayout).toHaveClass(/mobile-show-record/);
    await expect.poll(() => finalLayout.evaluate((element) => {
      const layoutRect = element.getBoundingClientRect();
      const recordRect = element.querySelector(".operator-record-data").getBoundingClientRect();
      return Math.abs(recordRect.left - layoutRect.left);
    })).toBeLessThanOrEqual(2);
    await archive.evaluate((element) => { element.scrollTop = 0; });
    const archiveBox = await archive.boundingBox();
    expect(archiveBox).toBeTruthy();
    await board.evaluate((element) => {
      element.scrollTop = Math.min(120, Math.max(0, element.scrollHeight - element.clientHeight));
    });
    const boardBefore = await board.evaluate((element) => element.scrollTop);
    expect(boardBefore).toBeGreaterThan(20);
    await touchSwipe(page, {
      x: archiveBox.x + archiveBox.width / 2,
      y: archiveBox.y + archiveBox.height * 0.24,
    }, {
      x: archiveBox.x + archiveBox.width / 2,
      y: archiveBox.y + archiveBox.height * 0.76,
    });
    await expect.poll(() => board.evaluate((element) => element.scrollTop)).toBeLessThan(boardBefore - 20);
  } else {
    const finalRecord = page.locator("#rows > .guess-card.is-final-record");
    await expect(finalRecord.locator(":scope > .mobile-record-pager")).toHaveCount(0);
    await expect(finalRecord.locator(".operator-record-layout")).toHaveCSS("display", "grid");
  }
});
