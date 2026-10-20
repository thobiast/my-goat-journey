import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { journeyFixture, seedJourney, storedJourney } from './support/journey-data';
import { nav, onDate, readDataset } from './support/habit-fixtures';

const evidence = 'artifacts/progress-refresh/screenshots';
const longGoal =
  'Read a chapter of my chosen book and write a thoughtful note about something I want to remember';
const longPillar =
  'Creative practice and everyday discoveries with a deliberately long pillar name';
test.setTimeout(90_000);

async function openProgress(page: Page, xp: number, today = '2026-10-04') {
  await seedJourney(page, xp);
  await onDate(page, today);
  await nav(page, 'Progress').click();
  await expect(page.locator('.progress-xp')).toBeVisible();
}

for (const [xp, level, earned, remaining] of [
  [0, 1, 0, 100],
  [100, 2, 0, 100],
  [420, 5, 20, 80],
]) {
  test(`Global XP ${xp} uses the total threshold but current-level bar`, async ({ page }) => {
    await openProgress(page, xp);
    const block = page.locator('.progress-xp');
    await expect(block.locator('.progress-xp-current')).toHaveText(
      `Level ${level}${xp} / ${xp + remaining} XP`,
    );
    await expect(block.locator('.progress-xp-next')).toHaveText(`Level ${level + 1}🚀`);
    await expect(
      block.getByRole('progressbar', { name: 'Progress toward the next level' }),
    ).toHaveAttribute('value', String(earned));
    await expect(block.getByRole('progressbar')).toHaveAttribute('max', '100');
    await expect(block.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      `${earned} of 100 XP toward the next level. ${remaining} XP to reach level ${level + 1}`,
    );
    await expect(block.locator('.progress-xp-rocket')).toHaveAttribute('aria-hidden', 'true');
    await expect(block.locator('button, a')).toHaveCount(0);
  });
}

test('Global XP ignores tabs filters intervals and historical navigation and preserves day return context', async ({
  page,
}) => {
  await openProgress(page, 10, '2026-10-11');
  const block = page.locator('.progress-xp');
  const unchanged = await block.innerHTML();
  const saved = await readDataset(page);
  await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const interval of ['1m', '3m', '12m', '24m', '7d']) {
    await page.getByRole('button', { name: interval, exact: true }).click();
    await expect(page.getByRole('button', { name: interval, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await block.innerHTML()).toBe(unchanged);
  }
  await page.locator('.progress-filters summary').click();
  await page.getByLabel('Pillar filter', { exact: true }).selectOption('mind');
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page.locator('.consistency-card')).toHaveCount(0);
  expect(await block.innerHTML()).toBe(unchanged);
  await page
    .locator('.progress-filters')
    .getByRole('button', { name: 'Reset filters', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Pillars', exact: true }).click();
  await page.getByRole('button', { name: 'Previous period', exact: true }).click();
  expect(await block.innerHTML()).toBe(unchanged);
  const day = page.locator('.aggregate-card [data-calendar-date="2026-10-03"]');
  await day.click();
  await expect(page.locator('.progress-day-page')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  await expect(day).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Pillars', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Next period', exact: true }).click();
  expect(await block.innerHTML()).toBe(unchanged);
  const after = await readDataset(page);
  expect({ ...after, revision: saved.revision, settings: saved.settings }).toEqual(saved);
});

test('Committed completion correction crosses a level boundary and validated backup replacement refreshes global XP', async ({
  page,
}) => {
  await seedJourney(page, 100);
  await nav(page, 'Today').click();
  const done = page.getByRole('checkbox', { name: 'Done: Isolated commitment 0', exact: true });
  await done.click();
  await expect(done).not.toBeChecked();
  await expect(done).toBeEnabled();
  await nav(page, 'Progress').click();
  await expect(page.locator('.progress-xp-current')).toHaveText('Level 190 / 100 XP');
  await nav(page, 'Today').click();
  await done.click();
  await expect(done).toBeChecked();
  await expect(done).toBeEnabled();
  await onDate(page, '2026-10-04');
  await nav(page, 'Progress').click();
  await expect(page.locator('.progress-xp-current')).toHaveText('Level 2100 / 200 XP');
  await page
    .locator('.consistency-card')
    .first()
    .locator('[data-calendar-date="2026-10-03"]')
    .click();
  const correction = page.getByRole('checkbox').first();
  await correction.click();
  await expect(correction).not.toBeChecked();
  await expect(correction).toBeEnabled();
  expect((await storedJourney(page)).occurrences.find((o) => o.habitId === 'trail-0')?.done).toBe(
    false,
  );
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  await expect(page.locator('.progress-xp-current')).toHaveText('Level 190 / 100 XP');
  await expect(page.locator('.progress-xp progress')).toHaveAttribute('value', '90');
  await nav(page, 'Settings').click();
  const candidate = journeyFixture(420);
  const before = await storedJourney(page);
  await page.getByLabel('Choose backup file', { exact: true }).setInputFiles({
    name: 'synthetic-progress.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'my-goat-journey-backup',
        formatVersion: 1,
        exportedAt: '2026-10-04T12:00:00.000Z',
        dataset: candidate,
      }),
    ),
  });
  await expect(page.getByText('Backup ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current data', exact: true }).click();
  await expect(page.getByText('Backup restored.', { exact: true })).toBeVisible();
  const after = await storedJourney(page);
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(after.occurrences).toHaveLength(42);
  expect(after.occurrences.every((o) => o.done)).toBe(true);
  await nav(page, 'Progress').click();
  await expect(page.locator('.progress-xp-current')).toHaveText('Level 5420 / 500 XP');
  await expect(page.locator('.progress-xp progress')).toHaveAttribute('value', '20');
  await page.reload();
  await nav(page, 'Progress').click();
  await expect(page.locator('.progress-xp-current')).toHaveText('Level 5420 / 500 XP');
});

for (const language of ['en', 'pt'] as const) {
  test(`Progress refresh ${language} wraps long names at 320 390 and wide with enlarged text`, async ({
    page,
  }) => {
    mkdirSync(evidence, { recursive: true });
    await seedJourney(page, 420);
    // Fictional fixture in this test's fresh context, never the normal preview diary.
    const fixture = await storedJourney(page);
    fixture.habits[0].versions[0].goal = longGoal;
    fixture.occurrences[0].goal = longGoal;
    fixture.pillars[0].nameOverride = longPillar;
    fixture.settings.language = language;
    await page.evaluate(
      (data) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('my-goat-journey');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('dataset', 'readwrite');
            tx.objectStore('dataset').put(data, 'current');
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => {
              db.close();
              reject(tx.error);
            };
          };
        }),
      fixture,
    );
    await page.reload();
    await onDate(page, '2026-10-04');
    await nav(page, language === 'en' ? 'Progress' : 'Progresso').click();
    const saved = await storedJourney(page);
    const block = page.locator('.progress-xp');
    await expect(block).toContainText(
      language === 'en' ? '80 XP to reach level 6' : 'Faltam 80 XP para o nível 6',
    );
    await expect(page.locator('.progress-filters')).not.toHaveAttribute('open');
    await expect(page.locator('.calendar-legend')).toHaveCount(1);
    for (const width of [320, 390, 1280])
      for (const text of [100, 200]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((text) => {
          document.documentElement.style.fontSize = `${text}%`;
          scrollTo(0, 0);
        }, text);
        const measured = await block.evaluate((node) => {
          const rect = (selector: string) =>
            node.querySelector(selector)!.getBoundingClientRect().toJSON();

          const bar = rect('progress');
          const current = rect('.progress-xp-current');
          const next = rect('.progress-xp-next');
          const style = getComputedStyle(node);
          const rocket = getComputedStyle(node.querySelector('.progress-xp-rocket')!);
          const icon = getComputedStyle(
            document.querySelector('.consistency-heading .pillar-icon')!,
          );
          const fraction = getComputedStyle(node.querySelector('.progress-xp-fraction')!);
          return {
            bar,
            current,
            next,
            rocketSize: rocket.fontSize,
            iconBackground: icon.backgroundColor,
            fractionColor: fraction.color,
            color: style.color,
            background: style.backgroundColor,
            border: style.borderWidth,
            overflow: document.documentElement.scrollWidth - innerWidth,
            controls: Array.from(
              document.querySelectorAll(
                '.progress-tabs button, .interval-selector button, .period-navigation button, .progress-filters summary',
              ),
            ).map((el) => el.getBoundingClientRect().toJSON()),
          };
        });
        expect(measured.overflow).toBeLessThanOrEqual(0);
        expect(measured.bar.width).toBeGreaterThan(250);
        expect(Math.abs(measured.current.left - measured.bar.left)).toBeLessThan(1);
        expect(Math.abs(measured.next.right - measured.bar.right)).toBeLessThan(1);
        expect(measured.rocketSize).toBe('28px');
        expect(measured.iconBackground).not.toBe('rgba(0, 0, 0, 0)');
        expect(measured.fractionColor).not.toBe(measured.color);
        expect(measured.background).toBe('rgba(0, 0, 0, 0)');
        expect(measured.border).toBe('0px');
        for (const control of measured.controls) {
          expect(control.width).toBeGreaterThanOrEqual(44);
          expect(control.height).toBeGreaterThanOrEqual(44);
        }
        const intervalLines = await page
          .locator('.interval-selector button')
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const range = document.createRange();
              range.selectNodeContents(button);
              return range.getClientRects().length;
            }),
          );
        expect(
          intervalLines.every((lines) => lines === 1),
          'Keep each short interval label intact',
        ).toBe(true);
        const splitWords = await page
          .locator('.consistency-card')
          .first()
          .evaluate((card) => {
            const split: string[] = [];
            const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (
                !node.parentElement?.closest(
                  '.consistency-heading, .period-fraction, .consistency-summary dl',
                )
              )
                continue;
              for (const match of node.textContent!.matchAll(/\p{L}+/gu)) {
                const range = document.createRange();
                range.setStart(node, match.index!);
                range.setEnd(node, match.index! + match[0].length);
                if (range.getClientRects().length > 1) split.push(match[0]);
              }
            }
            return split;
          });
        expect(splitWords, `${language}-${width}-text${text}: natural whole-word wrapping`).toEqual(
          [],
        );
        const name = `${language}-${width}-text${text}`;
        await page.screenshot({ path: `${evidence}/${name}-top.png` });
        const first = page.locator('.consistency-card').first();
        await expect(first.getByRole('button', { name: longGoal, exact: true })).toBeVisible();
        await first
          .locator('.daily-calendar')
          .evaluate((node) => node.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `${evidence}/${name}-calendar.png` });
        const donut = await first.locator('.period-donut').evaluate((node) => {
          const outer = node.getBoundingClientRect();
          const inner = node.querySelector('.period-percent')!.getBoundingClientRect();
          return { outer: outer.toJSON(), inner: inner.toJSON() };
        });
        expect(donut.inner.left).toBeGreaterThan(donut.outer.left);
        expect(donut.inner.right).toBeLessThan(donut.outer.right);
        await first
          .locator('.consistency-summary dl')
          .evaluate((node) => node.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `${evidence}/${name}-metrics.png` });
      }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '100%';
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page
      .getByRole('tab', { name: language === 'en' ? 'Pillars' : 'Pilares', exact: true })
      .click();
    await expect(page.locator('.aggregate-card')).toHaveCount(1);
    await expect(page.locator('.calendar-legend')).toHaveCount(1);
    await page
      .locator('.consistency-card.mind')
      .evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${evidence}/${language}-390-pillars.png` });
    expect(await storedJourney(page)).toEqual(saved);
  });
}
