import { test, expect, type Page } from '@playwright/test';
import { calculateProgress } from '../src/domain/progress';
import {
  setupScheduledHabits,
  onDate,
  readDataset,
  scheduledHabitGoals,
  abortNextWrite,
  nav,
} from './support/habit-fixtures';
import { holdNextCommit, commitHeld, releaseCommit } from './support/pwa-update';

const goal = scheduledHabitGoals[1];

const row = (page: Page) =>
  page.locator('article').filter({ has: page.getByRole('heading', { name: goal, exact: true }) });

const burst = (page: Page) => row(page).locator('.today-xp-feedback');

async function setup(page: Page) {
  await setupScheduledHabits(page);
  await page.clock.pauseAt(new Date('2026-09-27T12:01:00'));
}

test('Today completion feedback uses the exact committed milestone award, then expires without replay', async ({
  page,
}) => {
  await setup(page);
  for (const date of ['2026-09-28', '2026-09-30']) {
    await onDate(page, date);
    await expect(row(page).getByRole('checkbox')).not.toBeChecked();
    await row(page).getByRole('checkbox').click();
    await expect(row(page).getByRole('checkbox')).toBeChecked();
  }
  await onDate(page, '2026-10-02');
  await expect(row(page).getByRole('checkbox')).not.toBeChecked();
  await row(page).getByRole('checkbox').click();
  await expect(row(page).getByRole('checkbox')).toBeChecked();
  const saved = await readDataset(page);
  const habitId = saved.habits.find(
    (habit: { versions: { goal: string }[] }) => habit.versions[0].goal === goal,
  )!.id;
  const award = calculateProgress(saved, '2026-10-02').awards.find(
    (item) => item.habitId === habitId && item.date === '2026-10-02',
  )!;
  expect(award).toMatchObject({ baseXp: 10, bonusXp: 10 });
  await expect(page.getByRole('status')).toHaveText(`Completion saved: ${goal} +20 XP`);
  await expect(burst(page)).toHaveText('+20 XP');
  await expect(burst(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('[role="status"]')).toHaveCount(1);
  await expect(page.locator('.today-xp-feedback')).toHaveCount(1);
  await page.clock.runFor(701);
  await expect(burst(page)).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(burst(page)).toHaveCount(0);
  await page.reload();
  await expect(row(page).getByRole('checkbox')).toBeChecked();
  await expect(burst(page)).toHaveCount(0);
  await expect(page.getByRole('status')).toBeEmpty();
});

test('seventh completion shows +40 XP beside the checkbox without reflow or goal overlap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  for (const date of [
    '2026-09-28',
    '2026-09-30',
    '2026-10-02',
    '2026-10-05',
    '2026-10-07',
    '2026-10-09',
  ]) {
    await onDate(page, date);
    await expect(row(page).getByRole('checkbox')).not.toBeChecked();
    await row(page).getByRole('checkbox').click();
    await expect(row(page).getByRole('checkbox')).toBeChecked();
  }
  await onDate(page, '2026-10-12');
  await expect(row(page).getByRole('checkbox')).not.toBeChecked();
  await page
    .getByRole('region', { name: 'Body', exact: true })
    .evaluate((node) => node.scrollIntoView({ block: 'start' }));

  const geometry = () =>
    row(page).evaluate((node) => {
      const rect = (selector: string) => {
        const r = node.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };

      return { goal: rect('h3'), check: rect('.habit-check'), details: rect('.habit-metrics') };
    });

  const before = await geometry();
  await row(page).getByRole('checkbox').click();
  await expect(row(page).getByRole('checkbox')).toBeChecked();
  await expect(burst(page)).toHaveText('+40 XP');
  await expect(page.getByRole('status')).toHaveText(`Completion saved: ${goal} +40 XP`);
  expect(await geometry()).toEqual(before);
  const motion = await burst(page).evaluate((element) => {
    const animation = element.getAnimations()[0];
    const frames = (animation.effect as KeyframeEffect).getKeyframes();
    animation.pause();
    animation.currentTime = 250;
    const floating = element.getBoundingClientRect();
    const goal = element.closest('article')!.querySelector('h3')!.getBoundingClientRect();
    return {
      frames: frames.map((frame) => ({ transform: frame.transform, opacity: frame.opacity })),
      pointer: getComputedStyle(element).pointerEvents,
      overlapsGoal:
        floating.left < goal.right &&
        floating.right > goal.left &&
        floating.top < goal.bottom &&
        floating.bottom > goal.top,
    };
  });
  expect(motion.pointer).toBe('none');
  expect(motion.overlapsGoal).toBe(false);
  expect(motion.frames).toEqual([
    { transform: 'translateY(0px)', opacity: '1' },
    { transform: 'translateY(-8px)', opacity: '0' },
  ]);
  await page.screenshot({
    path: 'artifacts/today-xp-feedback/screenshots/milestone-40xp-en-390.png',
  });
  await page.clock.runFor(701);
  await expect(burst(page)).toHaveCount(0);
});

for (const action of ['checkbox', 'retry'] as const)
  test(`enabled ${action} action queues behind a background read instead of being dropped`, async ({
    page,
  }) => {
    await setup(page);
    await onDate(page, '2026-09-28');
    const checkbox = row(page).getByRole('checkbox');
    if (action === 'retry') {
      await abortNextWrite(page);
      await checkbox.click();
      await expect(page.getByRole('alert')).toContainText('Could not save');
    }
    const before = await readDataset(page);
    await holdNextCommit(page, 'readonly');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => commitHeld(page)).toBe(true);
    await expect(checkbox).toBeEnabled();
    if (action === 'retry') await page.getByRole('button', { name: 'Retry', exact: true }).click();
    else await checkbox.click();
    await expect(checkbox).toBeDisabled();
    await expect(burst(page)).toHaveCount(0);
    await releaseCommit(page);
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeEnabled();
    await expect(burst(page)).toHaveText('+10 XP');
    expect((await readDataset(page)).revision).toBe(before.revision + 1);
  });

test('failed completion stays silent; delayed Retry announces only its committed award once despite rapid Retry', async ({
  page,
}) => {
  await setup(page);
  await onDate(page, '2026-09-28');
  const checkbox = row(page).getByRole('checkbox');
  const before = await readDataset(page);
  await abortNextWrite(page);
  await checkbox.click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(checkbox).not.toBeChecked();
  await expect(burst(page)).toHaveCount(0);
  await expect(page.getByRole('status')).toBeEmpty();
  expect(await readDataset(page)).toEqual(before);
  await holdNextCommit(page);
  // Invoke the already-bound Retry twice in the same turn, before React can disable it.
  await page.getByRole('button', { name: 'Retry', exact: true }).evaluate((button) => {
    const key = Object.keys(button).find((key) => key.startsWith('__reactProps$'))!;
    const props = (button as unknown as Record<string, { onClick: () => void }>)[key];
    props.onClick();
    props.onClick();
  });
  await expect.poll(() => commitHeld(page)).toBe(true);
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).not.toBeChecked();
  await expect(burst(page)).toHaveCount(0);
  await expect(page.getByRole('status')).toBeEmpty();
  await expect(page.locator('.header-xp > span[aria-hidden=true]')).toHaveText('0 XP');
  await releaseCommit(page);
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeEnabled();
  await expect(burst(page)).toHaveText('+10 XP');
  await expect(page.getByRole('status')).toHaveText(`Completion saved: ${goal} +10 XP`);
  expect((await readDataset(page)).revision).toBe(before.revision + 1);
  await page.clock.runFor(701);
  await expect(burst(page)).toHaveCount(0);
  await page.clock.runFor(1000);
  await expect(burst(page)).toHaveCount(0);
});

test('rapid Today invocation commits once; uncheck is silent and recheck is a new action without navigation replay', async ({
  page,
}) => {
  await setup(page);
  await onDate(page, '2026-09-28');
  const checkbox = row(page).getByRole('checkbox');
  const before = await readDataset(page);
  await holdNextCommit(page);
  await checkbox.evaluate((input) => {
    const key = Object.keys(input).find((key) => key.startsWith('__reactProps$'))!;
    const props = (input as unknown as Record<string, { onChange: () => void }>)[key];
    props.onChange();
    props.onChange();
  });
  await expect.poll(() => commitHeld(page)).toBe(true);
  await expect(burst(page)).toHaveCount(0);
  await releaseCommit(page);
  await expect(checkbox).toBeChecked();
  await expect(burst(page)).toHaveText('+10 XP');
  expect((await readDataset(page)).revision).toBe(before.revision + 1);
  await nav(page, 'Journey').click();
  await nav(page, 'Today').click();
  await expect(burst(page)).toHaveCount(0);
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(burst(page)).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText(`Completion undone: ${goal}`);
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(burst(page)).toHaveText('+10 XP');
  expect(calculateProgress(await readDataset(page), '2026-09-28').totalXp).toBe(10);
});

for (const motion of ['os', 'app'] as const) {
  test(`${motion} reduced motion keeps committed text and the single success announcement without movement`, async ({
    page,
  }) => {
    await setup(page);
    if (motion === 'os') await page.emulateMedia({ reducedMotion: 'reduce' });
    else {
      await nav(page, 'Settings').click();
      await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).click();
      await expect(
        page.getByRole('checkbox', { name: 'Reduce motion', exact: true }),
      ).toBeChecked();
      await nav(page, 'Today').click();
    }
    await row(page).getByRole('checkbox').click();
    await expect(burst(page)).toHaveText('+10 XP');
    expect(await burst(page).evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'none',
    );
    await expect(page.getByRole('status')).toHaveText(`Completion saved: ${goal} +10 XP`);
    await expect(page.getByRole('status')).toHaveCount(1);
    await page.clock.runFor(701);
    await expect(burst(page)).toHaveCount(0);
  });
}

test('peer completion refresh and historical correction never echo a Today reward', async ({
  page,
  context,
}) => {
  await setup(page);
  await onDate(page, '2026-09-28');
  const peer = await context.newPage();
  await peer.clock.install({ time: new Date('2026-09-28T12:00:00') });
  await peer.goto(page.url());
  await expect(row(peer).getByRole('checkbox')).not.toBeChecked();
  await row(page).getByRole('checkbox').click();
  await expect(row(page).getByRole('checkbox')).toBeChecked();
  await expect(row(peer).getByRole('checkbox')).toBeChecked();
  await expect(peer.locator('.today-xp-feedback')).toHaveCount(0);
  await expect(peer.getByRole('status')).toBeEmpty();
  await peer.close();
  await onDate(page, '2026-09-30');
  await expect(row(page).getByRole('checkbox')).not.toBeChecked();
  await nav(page, 'Progress').click();
  await page.getByRole('button', { name: goal, exact: true }).click();
  const correction = page
    .locator('.correction-row')
    .filter({ has: page.locator('time[datetime="2026-09-28"]') })
    .getByRole('checkbox');
  await expect(correction).toBeChecked();
  await correction.click();
  await expect(correction).not.toBeChecked();
  await expect(page.getByRole('status')).not.toContainText('+');
  await nav(page, 'Today').click();
  await expect(page.locator('.today-xp-feedback')).toHaveCount(0);
});

test('Portuguese Today success includes its committed XP without adding another live region', async ({
  page,
}) => {
  await setup(page);
  await nav(page, 'Settings').click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await nav(page, 'Hoje').click();
  await row(page).getByRole('checkbox').click();
  await expect(row(page).getByRole('checkbox')).toBeChecked();
  await expect(burst(page)).toHaveText('+10 XP');
  await expect(page.getByRole('status')).toHaveText(`Conclusão salva: ${goal} +10 XP`);
  await expect(page.locator('[aria-live]')).toHaveCount(1);
});

test('restoring committed completions from a validated backup never replays action feedback', async ({
  page,
}) => {
  await setup(page);
  await row(page).getByRole('checkbox').click();
  await expect(row(page).getByRole('checkbox')).toBeChecked();
  const { revision: _revision, ...dataset } = await readDataset(page);
  const bytes = Buffer.from(
    JSON.stringify({
      format: 'my-goat-journey-backup',
      formatVersion: 1,
      exportedAt: '2026-09-27T12:00:00.000Z',
      dataset,
    }),
  );
  await row(page).getByRole('checkbox').click();
  await expect(row(page).getByRole('checkbox')).not.toBeChecked();
  await nav(page, 'Settings').click();
  await page
    .getByLabel('Choose backup file', { exact: true })
    .setInputFiles({ name: 'today-xp-fixture.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  await nav(page, 'Today').click();
  await expect(row(page).getByRole('checkbox')).toBeChecked();
  await expect(page.locator('.today-xp-feedback')).toHaveCount(0);
  await expect(page.getByRole('status')).toBeEmpty();
  const { revision: _restoredRevision, ...restored } = await readDataset(page);
  expect(restored).toEqual(dataset);
});

test('feedback component survives StrictMode, localizes numbers, never replays an id, and cleans up its timer', async ({
  page,
}) => {
  test.skip(
    (process.env.BASE_URL ?? '').includes('runtime'),
    'Component lifecycle probe uses development modules',
  );
  await page.clock.install({ time: new Date('2026-09-27T12:00:00') });
  await page.goto('./');
  await page.clock.pauseAt(new Date('2026-09-27T12:01:00'));
  await page.evaluate(async () => {
    const entry = new URL('./', location.href);
    const source = await (await fetch(new URL('src/main.tsx', entry))).text();
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    const reactUrl = imports.find((url) => /\/react\.js\?/.test(url))!;
    const clientUrl = imports.find((url) => /\/react-dom_client\.js\?/.test(url))!;
    const [
      { default: React },
      {
        default: { createRoot },
      },
      { XpFeedback },
    ] = await Promise.all([
      import(new URL(reactUrl, location.origin).href),
      import(new URL(clientUrl, location.origin).href),
      import(new URL('src/features/today/XpFeedback.tsx', entry).href),
    ]);
    const host = document.createElement('div');
    host.dataset.xpProbe = 'true';
    document.body.append(host);
    const root = createRoot(host);
    const pending = new Set<number>();
    const schedule = window.setTimeout;
    const cancel = window.clearTimeout;
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = schedule(() => {
        pending.delete(id);
        if (typeof callback === 'function') callback(...args);
      }, delay);
      if (delay === 700) pending.add(id);
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = (id) => {
      if (typeof id === 'number') pending.delete(id);
      cancel(id);
    };
    (window as unknown as { xpProbe: unknown }).xpProbe = {
      render: (feedback?: { id: number; xp: number }, language = 'en') =>
        root.render(
          React.createElement(
            React.StrictMode,
            {},
            React.createElement(XpFeedback, {
              feedback: feedback && { ...feedback, habitId: 'probe', date: '2026-09-27' },
              language,
            }),
          ),
        ),
      pending: () => pending.size,
      unmount: () => {
        root.unmount();
        window.setTimeout = schedule;
        window.clearTimeout = cancel;
        return pending.size;
      },
    };
  });
  const feedback = page.locator('[data-xp-probe] .today-xp-feedback');

  const render = (id?: number, xp = 1010, language = 'en') =>
    page.evaluate(
      ({ id, xp, language }) =>
        (
          window as unknown as {
            xpProbe: { render: (feedback?: { id: number; xp: number }, language?: string) => void };
          }
        ).xpProbe.render(id === undefined ? undefined : { id, xp }, language),
      { id, xp, language },
    );

  const pending = () =>
    page.evaluate(() =>
      (window as unknown as { xpProbe: { pending: () => number } }).xpProbe.pending(),
    );

  await render(1);
  await expect(feedback).toHaveText('+1,010 XP');
  expect(await pending()).toBe(1);
  await page.clock.runFor(350);
  await render(1, 1010, 'pt');
  await expect(feedback).toHaveText('+1.010 XP');
  await page.clock.runFor(351);
  await expect(feedback).toHaveCount(0);
  expect(await pending()).toBe(0);
  await render();
  await render(1);
  await expect(feedback).toHaveCount(0);
  await render(2, 20);
  await expect(feedback).toHaveText('+20 XP');
  expect(await pending()).toBe(1);
  const remaining = await page.evaluate(() =>
    (window as unknown as { xpProbe: { unmount: () => number } }).xpProbe.unmount(),
  );
  expect(remaining).toBe(0);
  await page.clock.runFor(701);
  await expect(feedback).toHaveCount(0);
});
