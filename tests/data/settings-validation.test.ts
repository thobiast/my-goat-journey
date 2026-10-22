import { expect, test } from 'vitest';
import { Repository } from '../../src/data/database';
import { parseBackup, serializeBackup } from '../../src/data/backup';
import type { Settings } from '../../src/domain/types';

const invalidPatches: Partial<Settings>[] = [
  { language: undefined },
  { reducedMotion: undefined },
  { language: undefined, reducedMotion: false, progressInterval: '1m' },
  { language: 'en', reducedMotion: undefined, progressInterval: '1m' },
];

for (const [index, patch] of invalidPatches.entries()) {
  test(`explicit undefined settings patch ${index} rejects atomically and stays exportable after reopen`, async () => {
    const repo = new Repository(crypto.randomUUID());
    await repo.createPillar('Fictional practice');
    const before = await repo.setSettings({
      language: 'pt',
      reducedMotion: true,
      progressInterval: '3m',
    });
    await expect(repo.setSettings(patch, before.revision)).rejects.toThrow(
      Object.hasOwn(patch, 'language') && patch.language === undefined
        ? 'Invalid language'
        : 'Invalid accessibility setting',
    );
    expect(await repo.load()).toEqual(before);
    await repo.close();
    const reopened = new Repository(repo.name);
    const after = await reopened.load();
    expect(after).toEqual(before);
    const { revision: _revision, ...facts } = before;
    expect((await parseBackup(serializeBackup(after))).dataset).toEqual({ ...facts, revision: 0 });
    await reopened.close();
  });
}

test('omitted settings preserve values, false is valid, and stale/failed updates roll back', async () => {
  let fail = false;
  const repo = new Repository(crypto.randomUUID(), () => fail);
  const initial = await repo.load();
  const before = await repo.setSettings(
    { language: 'pt', reducedMotion: true, progressInterval: '3m' },
    initial.revision,
  );
  expect(await repo.setSettings({}, before.revision)).toEqual(before);
  await expect(repo.setSettings({ reducedMotion: false }, initial.revision)).rejects.toMatchObject({
    code: 'stale-revision',
  });
  fail = true;
  await expect(repo.setSettings({ reducedMotion: false }, before.revision)).rejects.toThrow(
    'Persistence failed',
  );
  expect(await repo.load()).toEqual(before);
  fail = false;
  const after = await repo.setSettings({ reducedMotion: false }, before.revision);
  expect(after).toEqual({
    ...before,
    revision: before.revision + 1,
    settings: { ...before.settings, reducedMotion: false },
  });
  expect(await new Repository(repo.name).load()).toEqual(after);
});
