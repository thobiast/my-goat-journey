import { test, expect } from '@playwright/test';

test('Today habits are grouped without inner metric dividers and only adjacent habits are separated on phone and desktop', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const goal of [
    'Read ten pages',
    'Complete my walk',
    'Prepare my snack',
    'Complete my care',
  ]) {
    await page.getByLabel('What do you want to do?').fill(goal);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page
    .getByLabel('What do you want to do?')
    .fill('Walk through my neighborhood, notice the trees and return at my own pace');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await page.clock.setSystemTime(new Date('2026-09-29T12:00:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.today-header')).toContainText('0 of 5 habits completed');
  const body = page.getByRole('region', { name: 'Body', exact: true });
  const mind = page.getByRole('region', { name: 'Mind', exact: true });
  for (const viewport of [
    { width: 320, height: 844 },
    { width: 360, height: 844 },
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const card of await body.locator('article').all()) {
      const primary = await card.locator('.goal-row').boundingBox();
      const metrics = await card.locator('.habit-metrics p').first().boundingBox();
      const gap = metrics!.y - (primary!.y + primary!.height);
      expect(gap).toBeGreaterThanOrEqual(2);
      expect(gap).toBeLessThanOrEqual(6);
      expect(
        await card
          .locator('.habit-metrics')
          .evaluate((n) => parseFloat(getComputedStyle(n).borderTopWidth)),
      ).toBe(0);
    }
    expect(
      await body
        .locator('article')
        .first()
        .evaluate((n) => parseFloat(getComputedStyle(n).borderTopWidth)),
    ).toBe(0);
    expect(
      await body
        .locator('article')
        .nth(1)
        .evaluate((n) => parseFloat(getComputedStyle(n).borderTopWidth)),
    ).toBe(1);
    expect(
      await mind.locator('article').evaluate((n) => parseFloat(getComputedStyle(n).borderTopWidth)),
    ).toBe(0);
    await body.evaluate((n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `artifacts/habit-spacing/habits-${viewport.width}.png` });
  }
  const check = body.getByRole('checkbox').first();
  await check.click();
  await expect(check).toBeChecked();
  await check.focus();
  await page.keyboard.press('Space');
  await expect(check).not.toBeChecked();
});
