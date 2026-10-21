import { expect, test, type Page } from '@playwright/test';
import { nav, scheduledHabitGoals, setupScheduledHabits } from './support/habit-fixtures';
import { expandFixturePillars } from './support/management-fixtures';

test.setTimeout(90_000);

const surface = (page: Page) => page.locator('dialog[data-action-surface]');
const habitTrigger = (page: Page) =>
  page.getByRole('button', {
    name: `Actions for habit: ${scheduledHabitGoals[3]}`,
    exact: true,
  });

async function list(page: Page) {
  await setupScheduledHabits(page);
  await nav(page, 'Pillars').click();
  await expandFixturePillars(page);
  // Nonempty inline values must survive every lock/unlock, not just reset to defaults.
  await page.evaluate(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.paddingRight = '7px';
  });
  await habitTrigger(page).scrollIntoViewIfNeeded();
}

async function presentation(page: Page) {
  return page.evaluate(() => ({
    overflow: document.documentElement.style.overflow,
    padding: document.body.style.paddingRight,
    x: scrollX,
    y: scrollY,
  }));
}

for (const method of ['requestClose', 'close'] as const) {
  test(`Native ${method} synchronizes the sheet and permits a one-click reopen`, async ({
    page,
  }) => {
    await list(page);
    const trigger = habitTrigger(page);
    const before = await presentation(page);
    expect(before.y).toBeGreaterThan(0);
    await trigger.click();
    await expect(surface(page)).toBeVisible();
    await expect(surface(page)).toHaveJSProperty('open', true);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect((await presentation(page)).overflow).toBe('hidden');
    await page.mouse.wheel(0, -400);
    expect((await presentation(page)).y).toBe(before.y);

    // Native platform dismissal: no synthetic keyboard or React click event.
    const cancelled = await surface(page).evaluate((node, method) => {
      let prevented = false;
      node.addEventListener(
        'cancel',
        (event) => {
          prevented = event.defaultPrevented;
        },
        { once: true },
      );
      (node as HTMLDialogElement)[method]();
      return prevented;
    }, method);
    expect(cancelled).toBe(method === 'requestClose');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).not.toHaveAttribute('aria-controls');
    await expect(surface(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await presentation(page)).toEqual(before);

    await trigger.click();
    await expect(surface(page)).toHaveJSProperty('open', true);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await surface(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(surface(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await presentation(page)).toEqual(before);
  });
}

test('A queued native close cannot dismiss a reopened sheet', async ({ page }) => {
  await list(page);
  const trigger = habitTrigger(page);
  const before = await presentation(page);
  await trigger.click();
  // Native close events are queued. Reopening the SAME node before delivery also
  // models the showModal/cleanup/showModal ordering of StrictMode effect replay.
  for (let attempt = 0; attempt < 2; attempt++) {
    const reopened = await surface(page).evaluate(
      (node) =>
        new Promise<boolean>((resolve) => {
          const dialog = node as HTMLDialogElement;
          node.addEventListener('close', () => queueMicrotask(() => resolve(dialog.open)), {
            once: true,
          });
          dialog.close();
          dialog.showModal();
        }),
    );
    expect(reopened).toBe(true);
    await expect(surface(page)).toHaveJSProperty('open', true);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(surface(page).getByRole('button').first()).toBeFocused();
    expect((await presentation(page)).overflow).toBe('hidden');
  }
  await surface(page).evaluate((node) => (node as HTMLDialogElement).requestClose());
  await expect(surface(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await presentation(page)).toEqual(before);
});

test('Escape, Close and backdrop restore focus, styles and scroll after repeated reopen', async ({
  page,
}) => {
  await list(page);
  const trigger = habitTrigger(page);
  const before = await presentation(page);
  for (const method of ['Escape', 'Close', 'backdrop']) {
    await trigger.click();
    await expect(surface(page)).toHaveJSProperty('open', true);
    await expect(surface(page).getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(surface(page).getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(surface(page).getByRole('button').first()).toBeFocused();
    if (method === 'Escape') await page.keyboard.press('Escape');
    else if (method === 'Close')
      await surface(page).getByRole('button', { name: 'Close', exact: true }).click();
    else await page.mouse.click(4, 4);
    await expect(surface(page)).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    expect(await presentation(page)).toEqual(before);
  }
});

test('Command navigation closes once without native close stealing destination focus', async ({
  page,
}) => {
  await list(page);
  const trigger = habitTrigger(page);
  const before = await presentation(page);
  await trigger.click();
  const command = surface(page).getByRole('button', {
    name: 'Move to another pillar',
    exact: true,
  });
  // Retain the node so the real queued close is observed even after React disposal.
  await surface(page).evaluate((node) => {
    const probe = window as typeof window & {
      actionCloseProbe?: {
        events: number;
        triggerFocus: number;
        destinationFocus: number;
        commands: number;
      };
    };
    const result = { events: 0, triggerFocus: 0, destinationFocus: 0, commands: 0 };
    probe.actionCloseProbe = result;
    node.addEventListener('close', () => {
      result.events++;
    });
    node.querySelector('button')!.addEventListener('click', () => {
      result.commands++;
    });
    document.addEventListener('focusin', (event) => {
      const target = event.target as HTMLElement;
      // Native close may restore the trigger synchronously BEFORE routing. Only a
      // later restoration would steal the destination's deliberate focus.
      if (target.matches('[data-action-trigger]') && result.destinationFocus > 0)
        result.triggerFocus++;
      if (target.id === 'pillar') result.destinationFocus++;
    });
  });
  await command.click();
  await expect(surface(page)).toHaveCount(0);
  await expect(page.getByLabel('Pillar', { exact: true })).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => {
        return (window as typeof window & { actionCloseProbe?: { events: number } })
          .actionCloseProbe?.events;
      }),
    )
    .toBe(1);
  expect(
    await page.evaluate(() => {
      return (window as typeof window & { actionCloseProbe?: object }).actionCloseProbe;
    }),
  ).toEqual({ events: 1, triggerFocus: 0, destinationFocus: 1, commands: 1 });
  expect((await presentation(page)).overflow).toBe(before.overflow);
  expect((await presentation(page)).padding).toBe(before.padding);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await surface(page).evaluate((node) => (node as HTMLDialogElement).requestClose());
  await expect(surface(page)).toHaveCount(0);
});

test('Breakpoint changes and desktop trigger switching retain keyboard behavior', async ({
  page,
}) => {
  await list(page);
  const trigger = habitTrigger(page);
  await trigger.click();
  await expect(surface(page)).toHaveJSProperty('open', true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(surface(page)).toHaveAttribute('aria-modal', 'false');
  await expect(surface(page)).toHaveJSProperty('open', false);
  await expect
    .poll(() => surface(page).evaluate((node) => node.matches(':popover-open')))
    .toBe(true);
  expect((await presentation(page)).overflow).toBe('auto');
  expect((await presentation(page)).padding).toBe('7px');

  const other = page.getByRole('button', { name: 'Actions for pillar: Hygiene', exact: true });
  await other.click();
  await expect(surface(page)).toHaveCount(1);
  await expect(surface(page)).toHaveAttribute('aria-label', 'Actions for pillar: Hygiene');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(surface(page).getByRole('button').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(surface(page).getByRole('button').nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(surface(page).getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(surface(page).getByRole('button').first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(surface(page).getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(surface(page)).toHaveCount(0);
  await expect(other).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(surface(page)).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(surface(page)).toHaveAttribute('aria-modal', 'true');
  await expect(surface(page)).toHaveJSProperty('open', true);
  expect((await presentation(page)).overflow).toBe('hidden');
  await surface(page).evaluate((node) => (node as HTMLDialogElement).requestClose());
  await expect(other).toHaveAttribute('aria-expanded', 'false');
  await expect(surface(page)).toHaveCount(0);
  await expect(other).toBeFocused();
  expect((await presentation(page)).overflow).toBe('auto');
  expect((await presentation(page)).padding).toBe('7px');
});
