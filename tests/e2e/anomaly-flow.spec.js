const { test, expect } = require("@playwright/test");
const {
  fullyInsideVisualViewport,
  openAnomalyThemePage,
  openHome,
  startAnomaly,
} = require("./helpers.js");

test.beforeEach(async ({ page }) => {
  await openHome(page);
});

test("异类审查：主题选择、十轮提交、逐轮复盘与总结页", async ({ page }) => {
  test.setTimeout(120_000);
  await openAnomalyThemePage(page);
  await expect(page.locator('.anomaly-theme-card[data-domain="mixed"]')).toHaveAttribute("aria-selected", "true");
  await startAnomaly(page, "mixed");
  await expect(page.locator("#anomalyScanBtn")).toBeEnabled();
  await expect(page.locator("#anomalyScanState")).toContainText("2");

  for (let round = 1; round <= 10; round += 1) {
    await expect(page.locator("#anomalyRoundIndex")).toHaveText(String(round).padStart(2, "0"));
    await expect(page.locator(".anomaly-option")).toHaveCount(4);
    await page.locator(".anomaly-option").first().click();
    await expect(page.locator("#anomalyConfirmBtn")).toBeEnabled();
    const answerResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/anomaly/answer");
    await page.locator("#anomalyConfirmBtn").click();
    await answerResponse;
    await expect(page.locator("#anomalyReview")).toBeVisible();
    await expect(page.locator(".anomaly-review-rule")).toBeVisible();
    await expect(page.locator(".anomaly-next")).toBeVisible();

    if (round < 10) {
      const nextResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/anomaly/next");
      await page.locator(".anomaly-next").click();
      await nextResponse;
      await expect(page.locator("#anomalyConsole")).toBeVisible();
    } else {
      await page.locator(".anomaly-next").click();
      await expect(page.locator("#anomalySummary")).toBeVisible();
      await expect(page.locator(".anomaly-summary-stats")).toContainText("10");
      await expect(page.locator(".anomaly-summary-actions")).toBeVisible();
    }
  }
});

test("异类审查：单域禁用扫描器，切回主题选择后状态重建", async ({ page }) => {
  await openAnomalyThemePage(page);
  await startAnomaly(page, "roster");
  await expect(page.locator("#anomalyScanBtn")).toBeDisabled();
  await expect(page.locator("#anomalyScanState")).toContainText("不支持");
  await page.locator("#anomalyRestartBtn").click();
  await expect(page.locator("#anomalyThemeSelect")).toBeVisible();
  await expect(page.locator('.anomaly-theme-card[data-domain="roster"]')).toHaveAttribute("aria-selected", "true");
});

test("扫描结果在触发后保持在当前可视区", async ({ page }) => {
  await openAnomalyThemePage(page);
  await startAnomaly(page, "mixed");
  const scanResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/anomaly/scan");
  await page.locator("#anomalyScanBtn").click();
  await scanResponse;
  await expect(page.locator("#anomalyHint")).toBeVisible();
  // smooth scrollIntoView 需要落定时间；串行负载下仿真较慢，给足缓冲避免抖动
  await page.waitForTimeout(600);
  await expect.poll(
    () => fullyInsideVisualViewport(page.locator("#anomalyHint")),
    { timeout: 6_000 }
  ).toBe(true);
});
