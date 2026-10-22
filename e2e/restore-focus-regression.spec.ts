import { test, expect } from '@playwright/test';
import { setupScheduledHabits, nav, readDataset } from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

for (const language of ['en', 'pt'] as const) {
  test(`successful replacement focuses Settings once after reopening a completed profile (${language})`, async ({
    page,
    browser,
  }) => {
    // Build the replacement independently through the UI in another isolated profile.
    const replacementPage = await browser.newPage();
    let candidate: Awaited<ReturnType<typeof readDataset>>;
    try {
      await setupScheduledHabits(replacementPage);
      await nav(replacementPage, en.settingsNav).click();
      if (language === 'pt') {
        await replacementPage.getByLabel(en.language, { exact: true }).selectOption('pt');
        await expect(
          replacementPage.getByRole('heading', { name: pt.settings, exact: true }),
        ).toBeVisible();
      }
      candidate = await readDataset(replacementPage);
    } finally {
      await replacementPage.close();
    }
    await setupScheduledHabits(page);
    const previous = language === 'en' ? pt : en;
    if (language === 'en') {
      await nav(page, en.settingsNav).click();
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(page.getByRole('heading', { name: pt.settings, exact: true })).toBeVisible();
    }
    // Reopening removes the incidental onboarding-step focus transition.
    await page.reload();
    await expect(
      page.getByRole('heading', { name: previous.today, exact: true, level: 1 }),
    ).toBeFocused();
    const settingsNav = nav(page, previous.settingsNav);
    for (
      let tabs = 0;
      tabs < 20 && !(await settingsNav.evaluate((node) => node === document.activeElement));
      tabs++
    )
      await page.keyboard.press('Tab');
    await expect(settingsNav).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: previous.settings, exact: true, level: 1 }),
    ).toBeFocused();
    const before = await readDataset(page);
    const { revision: _revision, ...dataset } = candidate;
    expect(candidate.habits[0].id).not.toBe(before.habits[0].id);
    await page.getByLabel(previous.chooseBackup, { exact: true }).setInputFiles({
      name: 'fictional-completed-profile.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'my-goat-journey-backup',
          formatVersion: 1,
          exportedAt: '2026-09-27T12:00:00.000Z',
          dataset,
        }),
      ),
    });
    const confirmation = page.locator('.settings-section .confirmation');
    const replace = confirmation.getByRole('button', { name: previous.replaceData, exact: true });
    await expect(replace).toBeVisible();
    await replace.focus();
    await page.evaluate(() => {
      const headings: string[] = [];
      const scrolls: { before: number; after: number; preventScroll: boolean }[] = [];
      Object.assign(window, { restoreHeadingFocuses: headings, restoreFocusScrolls: scrolls });
      const focus = HTMLHeadingElement.prototype.focus;
      HTMLHeadingElement.prototype.focus = function (options) {
        const before = scrollY;
        focus.call(this, options);
        scrolls.push({ before, after: scrollY, preventScroll: options?.preventScroll === true });
      };
      document.addEventListener('focusin', (event) => {
        if (event.target instanceof HTMLHeadingElement && event.target.tagName === 'H1')
          headings.push(event.target.textContent ?? '');
      });
    });
    await page.keyboard.press('Enter');
    const copy = language === 'en' ? en : pt;
    await expect(page.getByRole('status').filter({ hasText: copy.backupRestored })).toHaveText(
      copy.backupRestored,
    );
    const heading = page.getByRole('heading', { name: copy.settings, exact: true, level: 1 });
    await expect(heading).toBeFocused();
    await expect(heading).toHaveAttribute('tabindex', '-1');
    await expect(nav(page, copy.settingsNav)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'pt' ? 'pt-BR' : 'en');
    expect(await readDataset(page)).toEqual({ ...dataset, revision: before.revision + 1 });
    // Layout/locale changes can clamp scroll; the focus operation itself must not scroll.
    const scrolls = await page.evaluate(
      () =>
        (
          window as Window & {
            restoreFocusScrolls?: { before: number; after: number; preventScroll: boolean }[];
          }
        ).restoreFocusScrolls!,
    );
    expect(scrolls).toHaveLength(1);
    expect(scrolls[0]).toEqual({ ...scrolls[0], after: scrolls[0].before, preventScroll: true });
    // Ordinary renders, locale updates and lifecycle reads must not replay recovery.
    const file = page.getByLabel(copy.chooseBackup, { exact: true });
    await file.focus();
    await page
      .getByLabel(copy.language, { exact: true })
      .selectOption(language === 'en' ? 'pt' : 'en');
    const other = language === 'en' ? pt : en;
    await expect(
      page.getByRole('heading', { name: other.settings, exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: other.settings, exact: true, level: 1 }),
    ).not.toBeFocused();
    await page.getByLabel(other.chooseBackup, { exact: true }).focus();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.clock.runFor(100);
    await expect(page.getByLabel(other.chooseBackup, { exact: true })).toBeFocused();
    expect(
      await page.evaluate(
        () => (window as Window & { restoreHeadingFocuses?: string[] }).restoreHeadingFocuses,
      ),
    ).toEqual([copy.settings]);
  });
}

for (const language of ['en', 'pt'] as const)
  test(`restore cancel returns keyboard focus without writing or stealing deletion focus (${language})`, async ({
    page,
  }) => {
    await setupScheduledHabits(page);
    await nav(page, en.settingsNav).click();
    if (language === 'pt') {
      await page.getByLabel(en.language, { exact: true }).selectOption('pt');
      await expect(
        page.getByRole('heading', { name: pt.settings, exact: true, level: 1 }),
      ).toBeVisible();
    }
    const copy = language === 'en' ? en : pt;
    const before = await readDataset(page);
    const { revision: _revision, ...dataset } = before;
    const file = {
      name: 'fictional-focus-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'my-goat-journey-backup',
          formatVersion: 1,
          exportedAt: '2026-09-27T12:00:00.000Z',
          dataset,
        }),
      ),
    };
    const input = page.getByLabel(copy.chooseBackup, { exact: true });
    // Parsing disables the file input; use a stable enabled control to detect stolen focus.
    const exportButton = page.getByRole('button', { name: copy.exportBackup, exact: true });
    await exportButton.focus();
    await input.setInputFiles({
      name: 'fictional-invalid-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{}'),
    });
    await expect(page.getByRole('alert')).toHaveText(copy.invalidBackup);
    await expect(exportButton).toBeFocused();
    expect(await readDataset(page)).toEqual(before);
    for (let attempt = 0; attempt < 2; attempt++) {
      await input.setInputFiles(file);
      const confirmation = page.locator('.settings-section .confirmation');
      const cancel = confirmation.getByRole('button', { name: copy.cancel, exact: true });
      await expect(cancel).toBeVisible();
      await cancel.focus();
      await cancel.press('Enter');
      await expect(confirmation).toHaveCount(0);
      await expect(input).toBeFocused();
      expect(await readDataset(page)).toEqual(before);
    }
    await input.setInputFiles(file);
    await expect(page.getByRole('heading', { name: copy.backupReady, exact: true })).toBeVisible();
    await page.getByRole('button', { name: copy.deleteOpen, exact: true }).click();
    const deletion = page.locator('.delete-section .confirmation');
    await expect(deletion.getByRole('button', { name: copy.cancel, exact: true })).toBeFocused();
    expect(await readDataset(page)).toEqual(before);
  });
