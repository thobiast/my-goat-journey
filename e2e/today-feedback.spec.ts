import { test, expect } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 360, height: 800 } });
test('silent completion keeps accessible success and visible errors while required-only counters follow Complete Undo', async ({
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
  await page.getByLabel('What do you want to do?').fill('Stretch slowly');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await page.clock.setSystemTime(new Date('2026-09-29T12:00:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const header = page.locator('.today-header');
  await expect(header).toContainText('0 of 5 habits completed');
  await expect(page.getByText('Required habits today', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('Optional reading');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(header).toContainText('0 of 5 habits completed');
  const row = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Complete my walk', exact: true }) });
  const summary = page.getByRole('list', { name: 'Pillar summary', exact: true });
  const summaryY = await summary.evaluate((n) => n.getBoundingClientRect().top + scrollY);
  await row.getByRole('checkbox').click();
  await expect(header).toContainText('1 of 5 habits completed');
  await expect(row.getByRole('checkbox')).toBeChecked();
  await expect(row.getByRole('checkbox')).toBeChecked();
  const feedback = page.getByRole('status');
  await expect(feedback).toHaveText('Completion saved: Complete my walk +10 XP');
  await expect(feedback).toHaveAttribute('aria-live', 'polite');
  const feedbackBox = await feedback.boundingBox();
  expect(feedbackBox!.width).toBeLessThanOrEqual(1);
  expect(feedbackBox!.height).toBeLessThanOrEqual(1);
  expect(await summary.evaluate((n) => n.getBoundingClientRect().top + scrollY)).toBe(summaryY);
  await page.clock.runFor(701);
  await expect(page.locator('.today-xp-feedback')).toHaveCount(0);
  const before = await row.innerText();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      IDBObjectStore.prototype.put = put;
      const result = put.apply(this, args);
      this.transaction.abort();
      return result;
    };
  });
  await row.getByRole('checkbox').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(header).toContainText('1 of 5 habits completed');
  expect(await row.innerText()).toBe(before);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(header).toContainText('0 of 5 habits completed');
  await expect(feedback).toHaveText('Completion undone: Complete my walk');
  expect((await feedback.boundingBox())!.height).toBeLessThanOrEqual(1);
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(header).toContainText('0 of 5 habits completed');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await page.getByRole('navigation').getByRole('button', { name: 'Hoje', exact: true }).click();
  await expect(header).toContainText('0 de 5 hábitos concluídos');
  await expect(page.getByText('Hábitos obrigatórios de hoje', { exact: true })).toHaveCount(0);
  await row.getByRole('checkbox').click();
  await expect(header).toContainText('1 de 5 hábitos concluídos');
  await expect(feedback).toHaveText('Conclusão salva: Complete my walk +10 XP');
  expect((await feedback.boundingBox())!.height).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/today-feedback/silent-success-pt-360.png' });
});
