import { test, expect, type Page } from '@playwright/test';
import {
  setupScheduledHabits,
  nav,
  scheduledHabitGoals,
  readDataset,
  abortNextWrite,
  onDate,
} from './support/habit-fixtures';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

const goal = (page: Page) => page.locator('#goal');

async function editor(page: Page) {
  await setupScheduledHabits(page);
  await onDate(page, '2026-10-02');
  await nav(page, 'Pillars').click();
  await page
    .getByRole('region', { name: 'Body', exact: true })
    .getByRole('button', { name: 'Body', exact: true })
    .click();
  await page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
}

for (const language of ['en', 'pt'] as const)
  test(`Discard modal preserves geometry, draft, focus and destination ${language}`, async ({
    page,
  }) => {
    await editor(page);
    if (language === 'pt') {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await nav(page, 'Settings').click();
      await page.getByLabel('Language', { exact: true }).selectOption('pt');
      await nav(page, 'Pilares').click();
      await page
        .getByRole('region', { name: 'Corpo', exact: true })
        .getByRole('button', { name: 'Corpo', exact: true })
        .click();
      await page
        .locator('.management-habit')
        .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) })
        .getByRole('button', { name: 'Editar', exact: true })
        .click();
    }
    const copy = language === 'en' ? en : pt;
    await page.setViewportSize({ width: 390, height: 740 });
    await goal(page).fill('My entire unsaved draft');
    await goal(page).focus();
    await page.evaluate(() => {
      const field = document.querySelector<HTMLTextAreaElement>('#goal')!;
      field.setSelectionRange(3, 9);
    });
    const before = await readDataset(page);
    // Keyboard activation avoids a test-induced auto-scroll of an offscreen Back link.
    const cancel = page.getByRole('button', { name: copy.cancel, exact: true });
    await cancel.scrollIntoViewIfNeeded();
    const geometry = await goal(page).boundingBox();
    const y = await page.evaluate(() => scrollY);
    await cancel.click();
    const dialog = page.getByRole('dialog', {
      name: language === 'en' ? 'Leave without saving?' : 'Sair sem salvar?',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-describedby', /.+/);
    await expect(dialog).toContainText(
      language === 'en'
        ? 'Your latest changes won’t be saved.'
        : 'Suas últimas alterações não serão salvas.',
    );
    await expect(dialog.getByRole('button', { name: copy.keepEditing, exact: true })).toBeFocused();
    expect(await goal(page).boundingBox()).toEqual(geometry);
    expect(await page.evaluate(() => scrollY)).toBe(y);
    expect(
      await nav(page, copy.today).evaluate((node) => {
        node.focus();
        return document.activeElement === node;
      }),
    ).toBe(false);
    await dialog.getByRole('button', { name: copy.discardChanges, exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: copy.keepEditing, exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(goal(page)).toHaveValue('My entire unsaved draft');
    await expect(goal(page)).toBeFocused();
    expect(
      await goal(page).evaluate((field: HTMLTextAreaElement) => [
        field.selectionStart,
        field.selectionEnd,
      ]),
    ).toEqual([3, 9]);
    expect(await page.evaluate(() => scrollY)).toBe(y);
    await nav(page, language === 'en' ? 'Journey' : 'Jornada').click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: copy.keepEditing, exact: true }).click();
    await expect(goal(page)).toHaveValue('My entire unsaved draft');
    await nav(page, copy.progress).click();
    await expect(dialog).toBeVisible();
    // A repeated supported internal request cannot overwrite the original destination.
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('nav button')!.click());
    await dialog.getByRole('button', { name: copy.discardChanges, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: copy.progress, level: 1, exact: true }),
    ).toBeVisible();
    expect(await readDataset(page)).toEqual(before);
  });

test('Restored drafts and loaded saved pending changes navigate without confirmation; failures retain drafts', async ({
  page,
}) => {
  await editor(page);
  await goal(page).fill('Temporary');
  await goal(page).fill(scheduledHabitGoals[1]);
  for (const day of ['Monday', 'Wednesday'])
    await page.getByRole('button', { name: day, exact: true }).click();
  for (const day of ['Wednesday', 'Monday'])
    await page.getByRole('button', { name: day, exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pillars', level: 1, exact: true })).toBeVisible();
  await page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await goal(page).fill('Scheduled walk');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(goal(page)).toHaveValue('Scheduled walk');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pillars', level: 1, exact: true })).toBeVisible();
  await page
    .locator('.management-habit')
    .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await goal(page).fill('Not persisted');
  const before = await readDataset(page);
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(goal(page)).toHaveValue('Not persisted');
  await nav(page, 'Today').click();
  await expect(
    page.getByRole('dialog', { name: 'Leave without saving?', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  expect(await readDataset(page)).toEqual(before);
});

test('Modal follows a reduced visual viewport without resizing the underlying editor', async ({
  page,
}) => {
  await editor(page);
  await page.setViewportSize({ width: 393, height: 850 });
  await page.evaluate(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { width: 393, height: 850, offsetLeft: 0, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  });
  await goal(page).fill('Keyboard-sized viewport draft');
  await nav(page, 'Today').click();
  const dialog = page.getByRole('dialog', { name: 'Leave without saving?', exact: true });
  await expect(dialog).toBeVisible();
  const editorBox = await goal(page).boundingBox();
  // Desktop Chromium has no software keyboard: retain the layout viewport and
  // simulate only the keyboard's visual-viewport bounds/events.
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.assign(viewport, { height: 300, offsetTop: 110 });
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect
    .poll(() =>
      dialog.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return r.top >= 110 && r.bottom <= 410;
      }),
    )
    .toBe(true);
  expect(await goal(page).boundingBox()).toEqual(editorBox);
  await page.screenshot({
    path: 'artifacts/pillars-ux-final/navigation/screenshots/dialog-visual-viewport-en-393.png',
  });
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(goal(page)).toHaveValue('Keyboard-sized viewport draft');
  await expect(goal(page)).toBeFocused();
});

for (const width of [320, 375, 390, 393, 402, 430, 440, 1280])
  for (const language of ['en', 'pt'] as const)
    test(`Modal responsive ${width}px ${language} enlarged and keyboard viewport`, async ({
      page,
    }) => {
      await editor(page);
      if (language === 'pt') {
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await nav(page, 'Settings').click();
        await page.getByLabel('Language', { exact: true }).selectOption('pt');
        await nav(page, 'Pilares').click();
        await page
          .getByRole('region', { name: 'Corpo', exact: true })
          .getByRole('button', { name: 'Corpo', exact: true })
          .click();
        await page
          .locator('.management-habit')
          .filter({ has: page.getByRole('heading', { name: scheduledHabitGoals[1], exact: true }) })
          .getByRole('button', { name: 'Editar', exact: true })
          .click();
      }
      const copy = language === 'en' ? en : pt;
      await page.setViewportSize({ width, height: 740 });
      await goal(page).fill('A draft preserved through dismissal');
      for (const text of [100, 200]) {
        await page.addStyleTag({ content: `html {font-size:${text}%}` });
        await nav(page, copy.today).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: copy.keepEditing, exact: true }),
        ).toBeFocused();
        await page.screenshot({
          path: `artifacts/pillars-ux-final/navigation/screenshots/dialog-${language}-${width}-text${text}.png`,
        });
        await page.setViewportSize({ width, height: 300 });
        await expect
          .poll(() =>
            dialog.evaluate((node) => {
              const r = node.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
            }),
          )
          .toBe(true);
        await dialog.getByRole('button', { name: copy.discardChanges, exact: true }).focus();
        await expect
          .poll(() =>
            dialog
              .getByRole('button', { name: copy.discardChanges, exact: true })
              .evaluate((node) => {
                const r = node.getBoundingClientRect();
                return r.top >= 0 && r.bottom <= innerHeight;
              }),
          )
          .toBe(true);
        await page.screenshot({
          path: `artifacts/pillars-ux-final/navigation/screenshots/dialog-short-${language}-${width}-text${text}.png`,
        });
        await page.keyboard.press('Escape');
        await expect(goal(page)).toHaveValue('A draft preserved through dismissal');
        await page.setViewportSize({ width, height: 740 });
        await nav(page, copy.today).click();
        // Backdrop / native close both mean Keep editing, never Discard.
        await page.mouse.click(2, 2);
        await expect(dialog).toHaveCount(0);
        await expect(goal(page)).toHaveValue('A draft preserved through dismissal');
        await nav(page, copy.today).click();
        await dialog.evaluate((node: HTMLDialogElement) => node.close());
        await expect(dialog).toHaveCount(0);
        await expect(goal(page)).toHaveValue('A draft preserved through dismissal');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    });
