import { expect, test, type Locator, type Page } from '@playwright/test';
import { nav, readDataset } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

test.use({ hasTouch: true });
type Mode = 'mouse' | 'touch' | 'keyboard';

async function activate(page: Page, target: Locator, mode: Mode) {
  if (mode === 'keyboard') {
    await target.focus();
    await page.keyboard.press('Enter');
  } else if (mode === 'touch') await target.tap();
  else await target.click();
}

async function headingFocus(page: Page, mode: Mode) {
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute('tabindex', '-1');
  await expect
    .poll(() => title.evaluate((element) => getComputedStyle(element).outlineStyle))
    .toBe(mode === 'keyboard' ? 'solid' : 'none');
  if (mode === 'keyboard') {
    expect(await title.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('3px');
    expect(await title.evaluate((element) => getComputedStyle(element).outlineColor)).toBe(
      'rgb(119, 80, 47)',
    );
  }
}

async function setup(page: Page, language: 'en' | 'pt', mode: Mode) {
  const copy = language === 'en' ? en : pt;
  await page.goto('./');
  if (language === 'pt') await page.getByLabel(en.language, { exact: true }).selectOption('pt');
  await activate(page, page.getByRole('button', { name: copy.start, exact: true }), mode);
  await expect(page.getByRole('heading', { name: copy.mind, exact: true })).toBeVisible();
  await headingFocus(page, mode);
  await page.screenshot({
    path: `artifacts/heading-focus/screenshots/onboarding-${language}-${mode}.png`,
  });
  await page.getByLabel(copy.goal, { exact: true }).fill('Literal focus regression habit');
  await activate(page, page.getByRole('button', { name: copy.continue, exact: true }), mode);
  for (const name of [copy.body, copy.nutrition, copy.hygiene]) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await headingFocus(page, mode);
    await activate(
      page,
      page.getByRole('button', { name: copy.onboardingSkip, exact: true }),
      mode,
    );
  }
  await expect(page.getByRole('heading', { name: copy.review, exact: true })).toBeVisible();
  await headingFocus(page, mode);
  await activate(page, page.getByRole('button', { name: copy.finalize, exact: true }), mode);
  await expect(page.getByRole('heading', { name: copy.today, exact: true })).toBeVisible();
  await headingFocus(page, mode);
  return copy;
}

for (const language of ['en', 'pt'] as const)
  for (const mode of ['mouse', 'touch', 'keyboard'] as const)
    test(`shared title focus across onboarding, navigation and nested return ${language} ${mode}`, async ({
      page,
    }) => {
      const copy = await setup(page, language, mode);
      const saved = await readDataset(page);
      await page.screenshot({
        path: `artifacts/heading-focus/screenshots/today-${language}-${mode}.png`,
      });
      for (const destination of [
        copy.pillars,
        copy.journey,
        copy.progress,
        copy.settingsNav,
        copy.today,
      ]) {
        await activate(page, nav(page, destination), mode);
        await headingFocus(page, mode);
      }
      // A real nested route preserves its specific return-to-origin target.
      await activate(page, nav(page, copy.pillars), mode);
      await activate(page, page.getByRole('button', { name: copy.newPillar, exact: true }), mode);
      await headingFocus(page, mode);
      await activate(page, page.getByRole('button', { name: copy.cancel, exact: true }), mode);
      await expect(page.getByRole('button', { name: copy.newPillar, exact: true })).toBeFocused();
      expect(
        await page
          .getByRole('heading', { level: 1 })
          .evaluate((element) => getComputedStyle(element).outlineStyle),
      ).toBe('none');
      await page.screenshot({
        path: `artifacts/heading-focus/screenshots/returned-pillars-${language}-${mode}.png`,
      });
      // Existing return-to-origin behavior is not replaced with generic title focus.
      await activate(page, nav(page, copy.today), mode);
      const add = page.getByRole('button', { name: copy.addHabit, exact: true });
      await activate(page, add, mode);
      await headingFocus(page, mode);
      await activate(page, page.getByRole('button', { name: copy.cancel, exact: true }), mode);
      await expect(add).toBeFocused();
      expect(await readDataset(page)).toEqual(saved);
    });

for (const language of ['en', 'pt'] as const)
  test(`Tab order and keyboard control focus stay visible ${language}`, async ({ page }) => {
    const copy = language === 'en' ? en : pt;
    await page.goto('./');
    if (language === 'pt') {
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      // Reopen the saved welcome, so its static target is focused as on entry.
      await page.reload();
    }
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(copy.language, { exact: true })).toBeFocused();
    expect(
      await page
        .getByLabel(copy.language, { exact: true })
        .evaluate((element) => getComputedStyle(element).outlineWidth),
    ).toBe('3px');
    await page.keyboard.press('Tab');
    const start = page.getByRole('button', { name: copy.start, exact: true });
    await expect(start).toBeFocused();
    expect(await start.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByLabel(copy.language, { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await headingFocus(page, 'keyboard');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(copy.goal, { exact: true })).toBeFocused();
    const field = page.getByLabel(copy.goal, { exact: true });
    expect(await field.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('3px');
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('H1');
    }
    // Pointer entry after keyboard input must not inherit a visible static ring.
    await page.getByRole('button', { name: copy.onboardingSkip, exact: true }).click();
    await headingFocus(page, 'mouse');
  });

for (const language of ['en', 'pt'] as const)
  for (const mode of ['mouse', 'keyboard'] as const)
    test(`modal containment and draft focus restoration remain intact ${language} ${mode}`, async ({
      page,
    }) => {
      const copy = await setup(page, language, mode);
      const saved = await readDataset(page);
      await activate(page, page.getByRole('button', { name: copy.addHabit, exact: true }), mode);
      const field = page.getByLabel(copy.goal, { exact: true });
      await field.fill('Unsaved literal modal draft');
      await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 8));
      await activate(page, nav(page, copy.settingsNav), mode);
      const dialog = page.getByRole('dialog', { name: copy.unsavedChanges, exact: true });
      await expect(dialog).toBeVisible();
      const keep = dialog.getByRole('button', { name: copy.keepEditing, exact: true });
      const discard = dialog.getByRole('button', { name: copy.discardChanges, exact: true });
      await expect(keep).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(discard).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(keep).toBeFocused();
      expect(await keep.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('3px');
      expect(
        await nav(page, copy.today).evaluate((element) => {
          (element as HTMLElement).focus();
          return document.activeElement === element;
        }),
      ).toBe(false);
      await page.screenshot({
        path: `artifacts/heading-focus/screenshots/modal-${language}-${mode}.png`,
      });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(field).toBeFocused();
      await expect(field).toHaveValue('Unsaved literal modal draft');
      expect(
        await field.evaluate((element: HTMLTextAreaElement) => [
          element.selectionStart,
          element.selectionEnd,
        ]),
      ).toEqual([2, 8]);
      expect(await field.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('3px');
      await activate(page, nav(page, copy.settingsNav), mode);
      await activate(page, discard, mode);
      await expect(page.getByRole('heading', { name: copy.settings, exact: true })).toBeVisible();
      await headingFocus(page, mode);
      expect(await readDataset(page)).toEqual(saved);
    });

test('fresh onboarding keeps its heading announcement focus without a pointer-entry rectangle', async ({
  page,
}, testInfo) => {
  await page.goto('./');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Small commitments. Your own journey.');
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAttribute('tabindex', '-1');
  const observation = await heading.evaluate((element) => {
    const css = getComputedStyle(element);
    return {
      active: document.activeElement === element,
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: css.outlineStyle,
      outlineWidth: css.outlineWidth,
      outlineColor: css.outlineColor,
    };
  });
  // Inspect real matched rule provenance, not only a guessed focus color.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' });
  const rules = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
  const outlineRules = rules.matchedCSSRules
    ?.filter((match) =>
      match.rule.style.cssProperties.some((property) => property.name.startsWith('outline')),
    )
    .map((match) => ({
      origin: match.rule.origin,
      selector: match.rule.selectorList.text,
      properties: match.rule.style.cssProperties.filter((property) =>
        property.name.startsWith('outline'),
      ),
    }));
  await testInfo.attach('heading-focus-provenance', {
    body: JSON.stringify({ observation, outlineRules }, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: 'artifacts/heading-focus/screenshots/fresh-onboarding-en.png' });
  expect(observation.outlineStyle).toBe('none');
});
