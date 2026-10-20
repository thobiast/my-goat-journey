import type { Dataset } from '../src/domain/types';
import { backControl, expandFixturePillars } from './support/management-fixtures';
import { test, expect, type Page } from '@playwright/test';

test.use({ locale: 'pt-BR' });

async function captureWidths(page: Page, name: string) {
  for (const width of [320, 360, 1000]) {
    await page.setViewportSize({ width, height: width === 1000 ? 900 : 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    for (const control of await page.locator('button, select, textarea').all()) {
      const box = await control.boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
    await page.screenshot({ path: `artifacts/screenshots/${name}-${width}.png`, fullPage: true });
  }
}

const goals = [
  'Read ten pages',
  'Complete my walk',
  'Prepare a fruit snack',
  'Complete my care routine',
];

async function setup(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const [index, goal] of goals.entries()) {
    await expect(
      page.getByRole('heading', {
        name: ['Mind', 'Body', 'Nutrition', 'Hygiene'][index],
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel('What do you want to do?').fill(goal);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-28T12:00:00') });
});
test('normal onboarding finalizes four optional first-day goals', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByText('No required goals today', { exact: true })).toBeVisible();
  await expect(page.getByText('Optional today', { exact: true })).toHaveCount(4);
  for (const goal of goals)
    await expect(page.getByRole('heading', { name: goal, exact: true })).toBeVisible();
  await captureWidths(page, 'normal-optional-en');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/screenshots/normal-optional-en-viewport-360.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Hoje', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hoje', exact: true })).toBeVisible();
  await captureWidths(page, 'normal-optional-pt');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/screenshots/normal-optional-pt-viewport-360.png' });
  await page.reload();
  await expect(page.getByText('Opcional hoje', { exact: true })).toHaveCount(4);
});
test('Done undo survives reload and failed transaction restores state with retry', async ({
  page,
}) => {
  await setup(page);
  const row = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: goals[0], exact: true }) });
  await row.getByRole('checkbox', { name: `Done: ${goals[0]}`, exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(`Completion saved: ${goals[0]} +10 XP`);
  await expect(row.getByRole('checkbox', { name: `Done: ${goals[0]}`, exact: true })).toBeChecked();
  await page.reload();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      IDBObjectStore.prototype.put = put;
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    };
  });
  await row.getByRole('checkbox').click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(row.getByRole('checkbox')).toBeChecked();
  await captureWidths(page, 'done-save-failed-en');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(`Completion undone: ${goals[0]}`);
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await page.reload();
  await expect(row.getByRole('checkbox')).not.toBeChecked();
});
test('custom pillar and contextual multiple habits reject empty weekdays', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name', { exact: true }).fill('Music & imagination');
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  const music = page.getByRole('region', { name: 'Music & imagination', exact: true });
  await expect(page.getByRole('heading', { name: 'Pillars', exact: true, level: 1 })).toBeVisible();
  await expandFixturePillars(page, ['Music & imagination']);
  await expect(music).toContainText('No habits yet.');
  await captureWidths(page, 'empty-custom-pillar-en');
  await music.getByRole('button', { name: 'Add habit', exact: true }).click();
  const customPillar = await page
    .getByLabel('Pillar', { exact: true })
    .locator('option')
    .filter({ hasText: 'Music & imagination' })
    .getAttribute('value');
  expect(customPillar).toBeTruthy();
  await expect(page.getByLabel('Pillar', { exact: true })).toHaveValue(customPillar!);
  await page.getByLabel('What do you want to do?').fill('Play a tune');
  await captureWidths(page, 'habit-creation-en');
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
    await page.getByRole('button', { name: day, exact: true }).click();
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('select at least one weekday');
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(music.getByRole('heading', { name: 'Play a tune', exact: true })).toBeVisible();
  await music.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('Write a melody');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await expect(music.locator('article')).toHaveCount(2);
  await captureWidths(page, 'custom-pillar-detail-en');
  await expect(page.getByRole('heading', { name: 'Pillars', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await expect(
    music.getByRole('button', { name: 'Music & imagination', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(music.locator('article')).toHaveCount(2);
});
test('language and reduced motion persist without changing habit records or context', async ({
  page,
}) => {
  await setup(page);

  const facts = async () =>
    page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const open = indexedDB.open('my-goat-journey');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const get = db.transaction('dataset').objectStore('dataset').get('current');
            get.onsuccess = () => {
              // This comparison reads the fixture initialized through onboarding above.
              const { habits, occurrences, pillars } = get.result as Pick<
                Dataset,
                'habits' | 'occurrences' | 'pillars'
              >;
              db.close();
              resolve(JSON.stringify({ habits, occurrences, pillars }));
            };
          };
        }),
    );

  const before = await facts();
  await page.getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await expect(page.getByRole('region', { name: 'Body', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await page.getByLabel('Reduzir movimento', { exact: true }).click();
  await expect(page.getByLabel('Reduzir movimento', { exact: true })).toBeChecked();
  await page.getByRole('navigation').getByRole('button', { name: 'Pilares', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pilares', exact: true, level: 1 })).toBeFocused();
  await expandFixturePillars(page);
  await expect(page.getByRole('region', { name: 'Corpo', exact: true })).toBeVisible();
  await expect(
    page.getByRole('navigation').getByRole('button', { name: 'Pilares', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: goals[1], exact: true })).toBeVisible();
  expect(await facts()).toBe(before);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hoje', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByLabel('Reduzir movimento', { exact: true })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
});
test('resume refreshes scheduled day and two required Body goals remain pending beside optional additions', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await page
    .getByRole('region', { name: 'Body', exact: true })
    .getByRole('button', { name: 'Add habit', exact: true })
    .click();
  await expect(page.getByLabel('Pillar', { exact: true })).toHaveValue('body');
  const longGoal =
    'Caminhar com atenção pelo meu bairro, observar as árvores e voltar no meu próprio ritmo, sem pressa e sem comparar meu progresso com o de outras pessoas';
  await page.getByLabel('What do you want to do?').fill(longGoal);
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.clock.setSystemTime(new Date('2026-09-29T12:00:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('0 of 5 habits completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add habit', exact: true }).click();
  await page.getByLabel('Pillar', { exact: true }).selectOption('body');
  await page.getByLabel('What do you want to do?').fill('Stretch when I choose');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  const body = page.getByRole('region', { name: 'Body', exact: true });
  await expect(body.locator('article')).toHaveCount(3);
  await expect(body.locator('article').last()).toContainText('Optional today');
  await body.getByRole('checkbox', { name: `Done: ${goals[1]}`, exact: true }).click();
  await expect(body.getByText('1/2 completed', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 5 habits completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pillars', exact: true }).click();
  await expandFixturePillars(page);
  await page.getByRole('button', { name: 'New pillar', exact: true }).click();
  await page.getByLabel('Pillar name', { exact: true }).fill('Music & imagination');
  await page.getByRole('button', { name: 'Save pillar', exact: true }).click();
  await expandFixturePillars(page, ['Music & imagination']);
  await page
    .getByRole('region', { name: 'Music & imagination', exact: true })
    .getByRole('button', { name: 'Add habit', exact: true })
    .click();
  await page.getByLabel('What do you want to do?').fill('Play a tune in my own time');
  await page.getByRole('button', { name: 'Save habit', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Music & imagination', exact: true }),
  ).toBeVisible();
  await captureWidths(page, 'scheduled-body-pending-en');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await captureWidths(page, 'settings-pt');
  await page.getByRole('navigation').getByRole('button', { name: 'Hoje', exact: true }).click();
  await expect(page.getByText('1/2 concluídos', { exact: true })).toBeVisible();
  await captureWidths(page, 'scheduled-body-pending-pt');
  for (const width of [320, 360, 1000]) {
    await page.setViewportSize({ width, height: width === 1000 ? 900 : 800 });
    await page
      .getByRole('region', { name: 'Corpo', exact: true })
      .evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `artifacts/screenshots/body-pending-pt-viewport-${width}.png` });
  }
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Idioma', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).click();
  await body.getByRole('checkbox', { name: `Done: ${longGoal}`, exact: true }).click();
  await expect(body.getByText('2/2 completed today', { exact: true })).toBeVisible();
});
test('midnight refreshes an open Today without reloading', async ({ page }) => {
  await page.clock.setSystemTime(new Date('2026-09-28T23:59:30'));
  await setup(page);
  await expect(page.getByText('No required goals today', { exact: true })).toBeVisible();
  await page.clock.runFor(60_000);
  await expect(page.locator('time[datetime="2026-09-29"]').first()).toBeVisible();
  await expect(page.getByText('0 of 4 habits completed', { exact: true })).toBeVisible();
  await expect(page.getByText('Optional today', { exact: true })).toHaveCount(0);
});
test('failed finalization leaves editable draft and retry creates four habits only', async ({
  page,
}) => {
  await page.goto('./');
  await captureWidths(page, 'welcome-en');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const [index, goal] of goals.entries()) {
    await expect(
      page.getByRole('heading', {
        name: ['Mind', 'Body', 'Nutrition', 'Hygiene'][index],
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel('What do you want to do?').fill(goal);
    if (index === 0) await captureWidths(page, 'onboarding-mind-en');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Review your goals', exact: true })).toBeVisible();
  await captureWidths(page, 'review-en');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      IDBObjectStore.prototype.put = put;
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    };
  });
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(page.getByRole('heading', { name: 'Review your goals', exact: true })).toBeVisible();
  await captureWidths(page, 'finalize-failed-en');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Review your goals', exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Start my journey', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.locator('article')).toHaveCount(4);
  await page.reload();
  await expect(page.locator('article')).toHaveCount(4);
});
test('Settings is a primary destination without Back and Today navigation restores heading focus by keyboard', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(backControl(page)).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeFocused();
});
test('rapid draft input is serialized before navigation and survives reopening', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page
    .getByLabel('What do you want to do?')
    .pressSequentially('Read a chapter without rushing', { delay: 0 });
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await page.getByRole('button', { name: 'Tuesday', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
  await backControl(page).click();
  await expect(page.getByLabel('What do you want to do?')).toHaveValue(
    'Read a chapter without rushing',
  );
  await expect(page.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Tuesday', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
test('Portuguese onboarding preserves full user goals and rejects whitespace-only goals', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('button', { name: 'Começar', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Começar', exact: true }).click();
  await page.getByLabel('O que você quer fazer?').fill('   ');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Informe um hábito.');
  for (const [index, goal] of goals.entries()) {
    await expect(
      page.getByRole('heading', {
        name: ['Mente', 'Corpo', 'Alimentação', 'Higiene'][index],
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel('O que você quer fazer?').fill(goal);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Revise suas metas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Começar minha jornada', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hoje', exact: true })).toBeVisible();
  for (const goal of goals)
    await expect(page.getByRole('heading', { name: goal, exact: true })).toBeVisible();
  await expect(page.getByText('Opcional hoje', { exact: true })).toHaveCount(4);
});
test('initial persistence failure offers retry rather than trapping loading', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      this.transaction.abort();
      return result;
    };
    (window as unknown as { restorePersistence: () => void }).restorePersistence = () => {
      IDBObjectStore.prototype.put = original;
    };
  });
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await page.evaluate(() =>
    (window as unknown as { restorePersistence: () => void }).restorePersistence(),
  );
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});
test('interrupted input resumes before Continue and review edits preserve exact text', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('  Read a chapter — at my own pace  ');
  await expect(page.getByRole('status')).toHaveText('Draft saved');
  await page.reload();
  await expect(page.getByLabel('What do you want to do?')).toHaveValue(
    '  Read a chapter — at my own pace  ',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (let index = 1; index < 4; index++) {
    await expect(
      page.getByRole('heading', {
        name: ['Mind', 'Body', 'Nutrition', 'Hygiene'][index],
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel('What do you want to do?').fill(goals[index]);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Edit Body', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('Walk outside when I choose');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your goals', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Walk outside when I choose', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('article')).toHaveCount(4);
});
