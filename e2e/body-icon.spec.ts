import { test, expect } from '@playwright/test';

test('Body official icon keeps consistent proportions sizes and identity colors in summary and header', async ({
  page,
}) => {
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
  const summary = page
    .getByRole('list', { name: 'Pillar summary' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Body', exact: true }) });
  const header = page.getByRole('region', { name: 'Body', exact: true }).locator('.pillar-header');
  for (const width of [320, 360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [icon, size, color] of [
      [summary.locator('svg'), 21, 'rgb(139, 70, 81)'],
      [header.locator('svg'), 21, 'rgb(255, 254, 250)'],
    ] as const) {
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
      await expect(icon).toHaveAttribute('focusable', 'false');
      await expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
      await expect(icon).toHaveAttribute('stroke-width', '1.8');
      await expect(icon).toHaveCSS('color', color);
      const box = await icon.boundingBox();
      expect(box!.width).toBe(size);
      expect(box!.height).toBe(size);
    }
    await expect(summary.locator('svg path')).toHaveCount(3);
    await expect(header.locator('svg path')).toHaveCount(3);
    for (const icon of await page
      .getByRole('list', { name: 'Pillar summary' })
      .locator('svg')
      .all()) {
      const box = await icon.boundingBox();
      expect(box!.width).toBe(21);
      expect(box!.height).toBe(21);
      await expect(icon).toHaveAttribute('stroke-width', '1.8');
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/body-icon/summary-${width}.png` });
    await header.evaluate((n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `artifacts/body-icon/header-${width}.png` });
  }
});
