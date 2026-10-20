import { expect, type Page } from '@playwright/test';

/** Explicit legacy fixture setup; never change the product's fresh-entry default. */
export async function expandFixturePillars(page: Page, names?: string[]) {
  await expect(page.locator('.management-pillar').first()).toBeVisible();
  const y = await page.evaluate(() => scrollY);
  const disclosures = names
    ? names.map((name) =>
        page.getByRole('region', { name, exact: true }).locator('.pillar-disclosure'),
      )
    : await page.locator('.management-pillar .pillar-disclosure').all();
  for (const disclosure of disclosures) {
    if ((await disclosure.getAttribute('aria-expanded')) === 'false') await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  }
  // Clicking a lower fixture disclosure must not shift legacy geometry origins.
  await page.evaluate((y: number) => scrollTo({ top: y, behavior: 'instant' }), y);
}

/** Onboarding uses a quiet Back; management children use a quiet destination. */
export const backControl = (page: Page) =>
  page
    .locator('main > header .quiet-back')
    .or(page.locator('.setup .onboarding-back'))
    .or(page.getByRole('button', { name: /^(?:Back|Voltar)$/ }));

/** Keep full habit identity while the review route uses a shared page title. */
export async function expectReview(page: Page, goal: string, focused = false) {
  const title = page.getByRole('heading', {
    name: /^(?:Review completions|Revisar conclusões)$/,
    level: 1,
  });
  await expect(title).toBeVisible();
  if (focused) await expect(title).toBeFocused();
  await expect(page.locator('.review-goal')).toHaveText(goal);
  await expect(page.getByRole('heading', { name: goal, exact: true, level: 2 })).toBeVisible();
}

/** Progress-origin legacy flows explicitly open the secondary native disclosure. */
export async function openReviewSupporting(page: Page) {
  await expect(
    page.getByRole('heading', { name: /^(?:Review completions|Revisar conclusões)$/, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('details.review-supporting').first()).toBeVisible();
  for (const section of await page
    .locator('details.review-supporting, details.review-management')
    .all()) {
    if ((await section.getAttribute('open')) === null)
      await section.locator(':scope > summary').click();
    await expect(section).toHaveAttribute('open', '');
  }
}
