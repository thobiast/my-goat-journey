import { test, expect } from '@playwright/test';
import { abortNextWrite, onDate, readDataset, nav } from './support/habit-fixtures';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-07T12:00:00') });
});
test.setTimeout(60_000);

test('skipped drafts survive Back, review edits, reload and explicit reconfiguration without accidental submission', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('  Mind keeps literal text 🎵  ');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
  await page.getByLabel('What do you want to do?').fill('  Body draft not yet included  ');
  for (const button of await page.locator('.weekdays button').all()) await button.click();
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nutrition', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
  await expect(page.getByLabel('What do you want to do?')).toHaveValue(
    '  Body draft not yet included  ',
  );
  await expect(page.locator('.weekdays button[aria-pressed=true]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nutrition', exact: true })).toBeVisible();
  await page.getByLabel('What do you want to do?').fill('Nutrition configured');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hygiene', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await page.getByRole('button', { name: 'Add habit Body', exact: true }).click();
  await expect(page.getByLabel('What do you want to do?')).toHaveValue(
    '  Body draft not yet included  ',
  );
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Draft saved');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your goals', exact: true })).toBeVisible();
  await expect(page.getByText('No habit added', { exact: true })).toHaveCount(2);
  expect((await readDataset(page)).habits).toEqual([]);
  await page.getByRole('button', { name: 'Add habit Body', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your goals', exact: true })).toBeVisible();
  await expect(page.getByText('No habit added', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const data = await readDataset(page);
  expect(data.habits.map((habit) => habit.versions[0].goal)).toEqual([
    '  Mind keeps literal text 🎵  ',
    '  Body draft not yet included  ',
    'Nutrition configured',
  ]);
  expect(data.occurrences).toEqual([]);
});

test('welcome language switching preserves pending literal goals and selected weekdays across reload', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('  Um hábito literal — never translated  ');
  await page.getByRole('button', { name: 'Saturday', exact: true }).click();
  await page.getByRole('button', { name: '← Back', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await expect(page.getByRole('button', { name: 'Começar', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel('Idioma', { exact: true })).toHaveValue('pt');
  await page.getByRole('button', { name: 'Começar', exact: true }).click();
  await expect(page.getByLabel('O que você quer fazer?')).toHaveValue(
    '  Um hábito literal — never translated  ',
  );
  await expect(page.getByRole('button', { name: 'Sábado', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  for (const name of ['Corpo', 'Alimentação', 'Higiene']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pular por enquanto', exact: true }).click();
  }
  await expect(
    page.getByText(
      'Hoje é uma oportunidade extra. Se não concluir, sua sequência não será interrompida.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText('Dom · Seg · Ter · Qua · Qui · Sex', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Começar minha jornada', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hoje', exact: true })).toBeVisible();
  expect((await readDataset(page)).habits[0].versions[0].goal).toBe(
    '  Um hábito literal — never translated  ',
  );
});

test('failed draft and final writes retain state, truthful status and duplicate protection', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // Arm the fault only after Start's asynchronous step write has committed.
  await expect(page.getByRole('heading', { name: 'Mind', exact: true })).toBeVisible();
  await abortNextWrite(page);
  await page.getByLabel('What do you want to do?').fill('One safely saved habit');
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(page.getByRole('status')).not.toHaveText('Draft saved');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Draft saved');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const name of ['Body', 'Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Review your goals', exact: true })).toBeVisible();
  const before = await readDataset(page);
  await abortNextWrite(page);
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  expect(await readDataset(page)).toEqual(before);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Review your goals', exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Start my journey', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect((await readDataset(page)).habits).toHaveLength(1);
  await page.reload();
  expect((await readDataset(page)).habits).toHaveLength(1);
});

test('empty default pillars do not block due-day completion and established users may archive their last habit', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('My only active habit');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const name of ['Body', 'Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await onDate(page, '2026-10-08');
  const done = page.getByRole('checkbox', { name: 'Done: My only active habit', exact: true });
  await expect(done).toBeVisible();
  await done.click();
  await expect(done).toBeChecked();
  await expect(
    page.getByText('Good job! All habits completed today.', { exact: true }),
  ).toBeVisible();
  await nav(page, 'Pillars').click();
  await page.getByRole('button', { name: 'Mind', exact: true }).click();
  const card = page.getByRole('region', { name: 'Mind', exact: true });
  await card
    .getByRole('button', { name: 'Actions for habit: My only active habit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await page.getByRole('button', { name: 'Archive habit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pillars', exact: true, level: 1 })).toBeVisible();
  const saved = await readDataset(page);
  expect(saved.onboardingComplete).toBe(true);
  expect(saved.habits).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect((await readDataset(page)).onboardingComplete).toBe(true);
});

for (const [language, goalLabel, next, skip, pillar, missingGoal, missingDays] of [
  [
    'en',
    'What do you want to do?',
    'Continue',
    'Skip for now',
    'Body',
    'Enter a habit.',
    'Select at least one day.',
  ],
  [
    'pt',
    'O que você quer fazer?',
    'Continuar',
    'Pular por enquanto',
    'Corpo',
    'Informe um hábito.',
    'Selecione pelo menos um dia.',
  ],
] as const)
  test(`field-specific validation preserves input, associates errors and focuses the first invalid field (${language})`, async ({
    page,
  }) => {
    await page.goto('./');
    if (language === 'pt') await page.getByLabel('Language', { exact: true }).selectOption('pt');
    await page
      .getByRole('button', { name: language === 'en' ? 'Start' : 'Começar', exact: true })
      .click();
    const goal = page.getByLabel(goalLabel, { exact: true });
    await expect(goal).toBeVisible();
    await page.getByRole('button', { name: next, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(missingGoal);
    await expect(goal).toBeFocused();
    await expect(goal).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(missingDays, { exact: true })).toHaveCount(0);
    await goal.fill('  A goal kept exactly as entered  ');
    const weekdays = page.locator('.weekdays button');
    for (const button of await weekdays.all()) await button.click();
    await page.getByRole('button', { name: next, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(missingDays);
    await expect(weekdays.first()).toBeFocused();
    await expect(page.locator('fieldset')).toHaveAttribute('aria-describedby', 'weekday-error');
    await expect(goal).toHaveValue('  A goal kept exactly as entered  ');
    await expect(goal).not.toHaveAttribute('aria-invalid', 'true');
    await goal.fill(' ');
    await page.getByRole('button', { name: next, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(2);
    await expect(goal).toBeFocused();
    await page.getByRole('button', { name: skip, exact: true }).click();
    await expect(page.getByRole('heading', { name: pillar, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await readDataset(page)).habits).toEqual([]);
  });

for (const [language, start, skip, title, finalize, add, minimum] of [
  [
    'en',
    'Start',
    'Skip for now',
    'Review your goals',
    'Start my journey',
    'Add habit Mind',
    'Add at least one habit to start your journey.',
  ],
  [
    'pt',
    'Começar',
    'Pular por enquanto',
    'Revise suas metas',
    'Começar minha jornada',
    'Adicionar hábito Mente',
    'Adicione pelo menos um hábito para começar sua jornada.',
  ],
] as const)
  test(`all-skipped review blocks finalization and focuses an accessible return path (${language})`, async ({
    page,
  }) => {
    await page.goto('./');
    if (language === 'pt') await page.getByLabel('Language', { exact: true }).selectOption('pt');
    await page.getByRole('button', { name: start, exact: true }).click();
    for (let index = 0; index < 4; index++) {
      await expect(page.getByRole('button', { name: skip, exact: true })).toBeEnabled();
      await page.getByRole('button', { name: skip, exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const before = await readDataset(page);
    await page.getByRole('button', { name: finalize, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(minimum);
    await expect(page.getByRole('button', { name: add, exact: true })).toBeFocused();
    expect(await readDataset(page)).toEqual(before);
    await page.getByRole('button', { name: add, exact: true }).press('Enter');
    const label = language === 'en' ? 'What do you want to do?' : 'O que você quer fazer?';
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
    await page.getByLabel(label, { exact: true }).fill('One chosen habit');
    await page
      .getByRole('button', { name: language === 'en' ? 'Continue' : 'Continuar', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: finalize, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: language === 'en' ? 'Today' : 'Hoje', exact: true }),
    ).toBeVisible();
    expect((await readDataset(page)).habits).toHaveLength(1);
  });

test('Field Notes welcome and compact review preserve artwork, weekday order and optional first-day wording', async ({
  page,
}) => {
  await page.goto('./');
  const logo = page.getByRole('img', { name: 'My GOAT Journey', exact: true });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', /branding\/My_GOAT_Journey_mountain_logo\.png$/);
  await expect(
    page.getByText(
      'Start with one habit. Choose the pillars that matter to you and the days that fit your routine. You can add more later.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await page.getByRole('heading', { level: 1 }).evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('Georgia');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText('1 of 4', { exact: true })).toBeVisible();
  await expect(page.getByLabel('What do you want to do?', { exact: true })).toHaveValue('');
  await expect(
    page.getByText('For example: Read 20 pages of a book.', { exact: true }),
  ).toBeVisible();
  const all = page.getByRole('button', { name: 'Every day', exact: true });
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  const weekdays = page.locator('.weekdays button');
  for (const button of await weekdays.all()) await button.click();
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  for (const day of ['Saturday', 'Tuesday', 'Monday'])
    await page.getByRole('button', { name: day, exact: true }).click();
  await page.getByLabel('What do you want to do?').fill('Mind subset');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
  await page.getByLabel('What do you want to do?').fill('Body every day');
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await all.click();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const pillar of ['Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name: pillar, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  }
  await expect(page.getByText('Mon · Tue · Sat', { exact: true })).toBeVisible();
  await expect(page.getByText('Every day', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Today is a bonus opportunity. Skipping it won’t break your streak.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('No habit added', { exact: true })).toHaveCount(2);
});

test('one explicitly configured habit and three skipped pillars finish without creating skipped drafts', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mind', exact: true })).toBeVisible();
  await page
    .getByLabel('What do you want to do?', { exact: true })
    .fill('Read 20 pages of my book');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Body', exact: true })).toBeVisible();
  await page.getByLabel('What do you want to do?', { exact: true }).fill('A draft I am not adding');
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  for (const pillar of ['Nutrition', 'Hygiene']) {
    await expect(page.getByRole('heading', { name: pillar, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Review your goals', exact: true })).toBeVisible();
  await expect(page.getByText('No habit added', { exact: true })).toHaveCount(3);
  await expect(page.getByText('A draft I am not adding', { exact: true })).toHaveCount(0);
  expect((await readDataset(page)).habits).toEqual([]);
  await page.getByRole('button', { name: 'Start my journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const data = await readDataset(page);
  expect(data.habits).toHaveLength(1);
  expect(data.pillars.map((pillar: { id: string }) => pillar.id)).toEqual([
    'mind',
    'body',
    'nutrition',
    'hygiene',
  ]);
  expect(data.occurrences).toEqual([]);
  expect(data.permanentUnlocks).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(await readDataset(page)).toEqual(data);
});
