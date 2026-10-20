import { expect, test, vi } from 'vitest';
import {
  BackupError,
  MAX_BACKUP_BYTES,
  parseBackup,
  serializeBackup,
  validateDataset,
} from '../../src/data/backup';
import { DEFAULT_PILLARS, type Dataset, type LegacyDataset } from '../../src/domain/types';
import { calculateProgress } from '../../src/domain/progress';

const now = new Date('2026-10-04T12:00:00.000Z');

function fixture(): Dataset {
  return {
    schemaVersion: 2,
    revision: 99,
    onboardingComplete: true,
    draft: null,
    settings: { language: 'pt', reducedMotion: true },
    pillars: [
      ...DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id })),
      { id: ' custom id ', name: '  Música 🎵  ' },
    ],
    habits: DEFAULT_PILLARS.map((id) => ({
      id: `habit ${id}`,
      createdOn: '2026-09-27',
      versions: [
        { effectiveFrom: '2026-09-27', goal: '  Ler ação 🎵 "quote"\n\\  ', weekdays: [1, 3, 5] },
      ],
      memberships: [{ effectiveFrom: '2026-09-27', pillarId: id }],
      periods: [{ id: `period ${id}`, start: '2026-09-27' }],
    })),
    occurrences: [
      {
        habitId: 'habit mind',
        date: '2026-09-30',
        goal: 'Historical snapshot ≠ current',
        pillarId: ' custom id ',
        kind: 'required',
        done: true,
        recordedAt: '2026-10-02T12:00:00Z',
        timezone: 'America/Sao_Paulo',
        offsetMinutes: 180,
        activationId: 'period mind',
        pillarParticipation: 'required',
        completionProvenance: 'credited',
        assignmentLocked: true,
      },
    ],
    permanentUnlocks: [{ id: ' opaque cosmetic / 🎵 ', unlockedAt: '2026-09-30T12:00:00Z' }],
  };
}

function envelope(dataset: unknown, exportedAt = now.toISOString()): Blob {
  return new Blob(
    [JSON.stringify({ format: 'my-goat-journey-backup', formatVersion: 1, exportedAt, dataset })],
    { type: 'application/json' },
  );
}

test('native complete backup preserves exact facts and recalculated progress without local revision', async () => {
  const data = fixture();
  const before = structuredClone(data);
  const blob = serializeBackup(data, now);
  expect(blob.type).toBe('application/json');
  const text = await blob.text();
  const raw = JSON.parse(text);
  expect(raw).toMatchObject({
    format: 'my-goat-journey-backup',
    formatVersion: 1,
    exportedAt: now.toISOString(),
  });
  expect(raw.dataset).not.toHaveProperty('revision');
  expect(blob.size).toBe(new TextEncoder().encode(text).byteLength);
  expect(text.charCodeAt(0)).not.toBe(0xfeff);
  const restored = await parseBackup(blob);
  expect(restored).toEqual({ dataset: { ...data, revision: 0 }, exportedAt: now.toISOString() });
  expect(calculateProgress(restored.dataset, '2026-10-04')).toEqual(
    calculateProgress(data, '2026-10-04'),
  );
  expect(data).toEqual(before);
  expect(validateDataset(data)).toEqual(data);
});

const corruptions: [string, (d: Dataset) => unknown][] = [
  [
    'duplicate pillars',
    (d) => {
      d.pillars.push({ ...d.pillars[0] });
      return d;
    },
  ],
  [
    'wrong default mapping',
    (d) => {
      d.pillars[0].defaultKey = 'body';
      return d;
    },
  ],
  [
    'missing preserved defaults',
    (d) => {
      d.pillars.splice(0, 1);
      return d;
    },
  ],
  [
    'duplicate habits',
    (d) => {
      d.habits.push(structuredClone(d.habits[0]));
      return d;
    },
  ],
  [
    'duplicate global periods',
    (d) => {
      d.habits[1].periods[0].id = d.habits[0].periods[0].id;
      return d;
    },
  ],
  [
    'empty definitions',
    (d) => {
      d.habits[0].versions = [];
      return d;
    },
  ],
  [
    'wrong first definition',
    (d) => {
      d.habits[0].versions[0].effectiveFrom = '2026-09-28';
      return d;
    },
  ],
  [
    'duplicate definitions',
    (d) => {
      d.habits[0].versions.push({ ...d.habits[0].versions[0] });
      return d;
    },
  ],
  [
    'unordered definitions',
    (d) => {
      d.habits[0].versions.push({ ...d.habits[0].versions[0], effectiveFrom: '2026-09-26' });
      return d;
    },
  ],
  [
    'empty memberships',
    (d) => {
      d.habits[0].memberships = [];
      return d;
    },
  ],
  [
    'wrong first membership',
    (d) => {
      d.habits[0].memberships[0].effectiveFrom = '2026-09-28';
      return d;
    },
  ],
  [
    'unordered memberships',
    (d) => {
      d.habits[0].memberships.push({ effectiveFrom: '2026-09-26', pillarId: 'body' });
      return d;
    },
  ],
  [
    'dangling membership',
    (d) => {
      d.habits[0].memberships[0].pillarId = 'absent';
      return d;
    },
  ],
  [
    'empty periods',
    (d) => {
      d.habits[0].periods = [];
      return d;
    },
  ],
  [
    'wrong initial period',
    (d) => {
      d.habits[0].periods[0].start = '2026-09-28';
      return d;
    },
  ],
  [
    'inverted period',
    (d) => {
      d.habits[0].periods[0].end = '2026-09-26';
      return d;
    },
  ],
  [
    'mismatched archival date',
    (d) => {
      Object.assign(d.habits[0].periods[0], { end: '2026-10-02', archivedOn: '2026-10-01' });
      return d;
    },
  ],
  [
    'archive with open period',
    (d) => {
      d.habits[0].periods[0].archivedOn = '2026-10-02';
      return d;
    },
  ],
  [
    'overlapping closed periods',
    (d) => {
      d.habits[0].periods[0].end = '2026-10-02';
      d.habits[0].periods.push({ id: 'later', start: '2026-10-02' });
      return d;
    },
  ],
  [
    'two open periods',
    (d) => {
      d.habits[0].periods.push({ id: 'later', start: '2026-10-05' });
      return d;
    },
  ],
  [
    'reactivation after start',
    (d) => {
      d.habits[0].periods[0].end = '2026-10-02';
      d.habits[0].periods.push({ id: 'later', start: '2026-10-05', reactivatedOn: '2026-10-06' });
      return d;
    },
  ],
  [
    'resumption not first effective due',
    (d) => {
      d.habits[0].periods[0].end = '2026-10-02';
      d.habits[0].periods.push({ id: 'later', start: '2026-10-07', reactivatedOn: '2026-10-02' });
      return d;
    },
  ],
  [
    'pending while active',
    (d) => {
      d.habits[0].pendingReactivation = { periodId: 'next', requestedOn: '2026-10-02' };
      return d;
    },
  ],
  [
    'pending before archive',
    (d) => {
      d.habits[0].periods[0].end = '2026-10-02';
      d.habits[0].pendingReactivation = { periodId: 'next', requestedOn: '2026-10-01' };
      return d;
    },
  ],
  [
    'pending reuses period identity',
    (d) => {
      d.habits[0].periods[0].end = '2026-10-02';
      d.habits[0].pendingReactivation = { periodId: 'period mind', requestedOn: '2026-10-02' };
      return d;
    },
  ],
  [
    'duplicate occurrences',
    (d) => {
      d.occurrences.push({ ...d.occurrences[0] });
      return d;
    },
  ],
  [
    'dangling habit',
    (d) => {
      d.occurrences[0].habitId = 'missing';
      return d;
    },
  ],
  [
    'dangling snapshot pillar',
    (d) => {
      d.occurrences[0].pillarId = 'missing';
      return d;
    },
  ],
  [
    'wrong activation linkage',
    (d) => {
      d.occurrences[0].activationId = 'period body';
      return d;
    },
  ],
  [
    'unscheduled extra credit',
    (d) => {
      d.occurrences[0].date = '2026-10-01';
      return d;
    },
  ],
  [
    'precreation credit',
    (d) => {
      d.occurrences[0].date = '2026-09-25';
      return d;
    },
  ],
  [
    'optional not creation',
    (d) => {
      d.occurrences[0].kind = 'optional';
      d.occurrences[0].pillarParticipation = 'on-completion';
      return d;
    },
  ],
  [
    'required creation',
    (d) => {
      d.occurrences[0].date = '2026-09-27';
      return d;
    },
  ],
  [
    'optional required pillar obligation',
    (d) => {
      d.occurrences[0].date = '2026-09-27';
      d.occurrences[0].kind = 'optional';
      return d;
    },
  ],
  [
    'true without credit provenance',
    (d) => {
      d.occurrences[0].completionProvenance = 'never-credited';
      return d;
    },
  ],
  [
    'true without lock',
    (d) => {
      d.occurrences[0].assignmentLocked = false;
      return d;
    },
  ],
  [
    'invented lock without credit',
    (d) => {
      d.occurrences[0].done = false;
      d.occurrences[0].completionProvenance = 'never-credited';
      return d;
    },
  ],
  [
    'unknown provenance without preservation lock',
    (d) => {
      d.occurrences[0].done = false;
      d.occurrences[0].completionProvenance = 'legacy-unknown';
      d.occurrences[0].assignmentLocked = false;
      return d;
    },
  ],
  [
    'exemption outside archive date',
    (d) => {
      d.occurrences[0].exempt = true;
      return d;
    },
  ],
  [
    'duplicate unlock',
    (d) => {
      d.permanentUnlocks.push({ ...d.permanentUnlocks[0] });
      return d;
    },
  ],
  [
    'dangling draft pillar',
    (d) => {
      d.onboardingComplete = false;
      d.draft = { step: 0, goals: [{ pillarId: 'absent', goal: '', weekdays: [] }] };
      return d;
    },
  ],
  [
    'too many draft goals',
    (d) => {
      d.onboardingComplete = false;
      d.draft = {
        step: 0,
        goals: Array.from({ length: 5 }, () => ({ pillarId: 'mind', goal: '', weekdays: [] })),
      };
      return d;
    },
  ],
  [
    'duplicate draft pillar',
    (d) => {
      d.onboardingComplete = false;
      d.draft = {
        step: 0,
        goals: [
          { pillarId: 'mind', goal: '', weekdays: [] },
          { pillarId: 'mind', goal: '', weekdays: [] },
        ],
      };
      return d;
    },
  ],
];
test.each(corruptions)('rejects structurally inconsistent facts: %s', (_name, corrupt) => {
  expect(() => validateDataset(corrupt(fixture()))).toThrow(BackupError);
});

test('archived/awaiting, credited Undo, ambiguous legacy false and legal snapshot differences survive', async () => {
  const data = fixture();
  for (const h of data.habits)
    Object.assign(h.periods[0], { end: '2026-10-02', archivedOn: '2026-10-02' });
  data.habits[0].pendingReactivation = { periodId: 'pending mind', requestedOn: '2026-10-02' };
  data.habits[0].versions.push({ effectiveFrom: '2026-10-03', goal: 'New goal', weekdays: [2, 4] });
  data.occurrences[0].done = false;
  data.occurrences.push({
    ...data.occurrences[0],
    date: '2026-10-02',
    completionProvenance: 'legacy-unknown',
    exempt: true,
  });
  for (const h of data.habits.slice(1))
    data.occurrences.push({
      ...data.occurrences[0],
      habitId: h.id,
      activationId: h.periods[0].id,
      pillarId: h.memberships[0].pillarId,
      date: '2026-10-02',
      completionProvenance: 'never-credited',
      assignmentLocked: false,
      exempt: true,
    });
  expect(validateDataset(data)).toEqual(data);
  expect((await parseBackup(serializeBackup(data, now))).dataset).toEqual({ ...data, revision: 0 });
  const cancelled = structuredClone(data);
  delete cancelled.habits[0].pendingReactivation;
  expect(validateDataset(cancelled)).toEqual(cancelled);
  const ended = structuredClone(cancelled);
  ended.habits[0].periods.push({ id: 'resumed', start: '2026-10-06', reactivatedOn: '2026-10-02' });
  expect(validateDataset(ended)).toEqual(ended);
});

test('incomplete setup accepts blank exact text and empty draft masks without enforcing finalized goals', async () => {
  const data = fixture();
  data.onboardingComplete = false;
  data.habits = [];
  data.occurrences = [];
  data.draft = {
    step: 2,
    goals: [
      { pillarId: 'mind', goal: '   ', weekdays: [] },
      { pillarId: 'body', goal: '  ação  ', weekdays: [6, 0] },
    ],
  };
  const restored = (await parseBackup(serializeBackup(data, now))).dataset;
  expect(restored).toEqual({
    ...data,
    revision: 0,
    draft: {
      step: 2,
      goals: [
        ...data.draft.goals,
        ...['nutrition', 'hygiene'].map((pillarId) => ({
          pillarId,
          goal: '',
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        })),
      ],
    },
  });
  expect(restored.draft!.goals[0]).toEqual({ pillarId: 'mind', goal: '   ', weekdays: [] });
  expect(restored.draft!.goals[1]).toEqual({
    pillarId: 'body',
    goal: '  ação  ',
    weekdays: [6, 0],
  });
});

test('legitimate unfinished review draft uses step five and preserves blanks', () => {
  const data = fixture();
  data.onboardingComplete = false;
  data.habits = [];
  data.occurrences = [];
  data.draft = {
    step: 5,
    goals: DEFAULT_PILLARS.map((pillarId) => ({ pillarId, goal: '  ', weekdays: [] })),
  };
  expect(validateDataset(data)).toEqual(data);
});

function legacyFixture(): LegacyDataset {
  const {
    revision: _revision,
    schemaVersion: _schemaVersion,
    habits,
    occurrences,
    ...facts
  } = fixture();
  return {
    ...facts,
    schemaVersion: 1,
    habits: habits.map((h) => ({
      id: h.id,
      createdOn: h.createdOn,
      periods: h.periods,
      versions: h.versions.map((v) => ({ ...v, pillarId: h.memberships[0].pillarId })),
    })),
    occurrences: occurrences.map(
      ({
        activationId: _activationId,
        pillarParticipation: _participation,
        completionProvenance: _provenance,
        assignmentLocked: _lock,
        exempt: _exempt,
        ...snapshot
      }) => snapshot,
    ),
  };
}

test('schema one migrates exact true and false historical snapshots without inferring false credit', async () => {
  const old = legacyFixture();
  old.occurrences.push({ ...old.occurrences[0], date: '2026-10-02', done: false });
  const parsed = await parseBackup(envelope(old));
  expect(parsed.dataset.schemaVersion).toBe(2);
  expect(parsed.dataset.occurrences[0]).toMatchObject({
    ...old.occurrences[0],
    completionProvenance: 'credited',
    assignmentLocked: true,
  });
  expect(parsed.dataset.occurrences[1]).toMatchObject({
    ...old.occurrences[1],
    completionProvenance: 'legacy-unknown',
    assignmentLocked: true,
  });
  expect(calculateProgress(parsed.dataset, '2026-10-04')).toEqual(
    calculateProgress(old, '2026-10-04'),
  );
  expect((await parseBackup(serializeBackup(parsed.dataset, now))).dataset).toEqual({
    ...parsed.dataset,
    revision: 0,
  });
});

test.each([-1, 0, 1])(
  'complete UTF-8 boundary at 20 MiB plus %i bytes is shared by export and restore',
  async (delta) => {
    expect(MAX_BACKUP_BYTES).toBe(20_971_520);
    const data = fixture();
    data.habits[0].periods[0].end = '2026-10-02';
    data.habits[0].pendingReactivation = { periodId: 'pending', requestedOn: '2026-10-02' };
    const target = MAX_BACKUP_BYTES + delta;
    const base = serializeBackup(data, now);
    data.habits[0].versions[0].goal += 'x'.repeat(target - base.size);
    const before = structuredClone(data);
    if (delta > 0) {
      expect(() => serializeBackup(data, now)).toThrow(expect.objectContaining({ code: 'size' }));
      const raw = envelope((({ revision: _r, ...portable }) => portable)(data));
      expect(raw.size).toBe(target);
      const read = vi.spyOn(raw, 'text');
      await expect(parseBackup(raw)).rejects.toMatchObject({ code: 'size' });
      expect(read).not.toHaveBeenCalled();
    } else {
      const blob = serializeBackup(data, now);
      expect(blob.size).toBe(target);
      const text = await blob.text();
      expect(text.length).toBeLessThan(blob.size);
      expect(new TextEncoder().encode(text).byteLength).toBe(target);
      const restored = await parseBackup(blob);
      expect(restored.dataset).toEqual({ ...data, revision: 0 });
      expect(calculateProgress(restored.dataset, '2026-10-04')).toEqual(
        calculateProgress(data, '2026-10-04'),
      );
      expect(await serializeBackup({ ...restored.dataset, revision: 1000 }, now).text()).toBe(text);
      if (delta === 0) {
        await expect(parseBackup(new Blob([text, ' ']))).rejects.toMatchObject({ code: 'size' });
      }
    }
    expect(data).toEqual(before);
  },
  30_000,
);

test('normalized candidate byte check uses the original exportedAt spelling, not a fresh clock', async () => {
  const { revision: _r, ...data } = fixture();
  const exportedAt = '2026-10-04T12:00:00Z';
  const base = envelope(data, exportedAt);
  data.habits[0].versions[0].goal += 'x'.repeat(MAX_BACKUP_BYTES - base.size);
  const file = envelope(data, exportedAt);
  expect(file.size).toBe(MAX_BACKUP_BYTES);
  const restored = await parseBackup(file);
  expect(restored.exportedAt).toBe(exportedAt);
  expect(restored.dataset).toEqual({ ...data, revision: 0 });
}, 30_000);

test('supported old file at the limit is rejected when complete current-schema migration expands over the cap', async () => {
  const old = legacyFixture();
  const base = envelope(old);
  old.habits[0].versions[0].goal += 'x'.repeat(MAX_BACKUP_BYTES - base.size);
  const file = envelope(old);
  expect(file.size).toBe(MAX_BACKUP_BYTES);
  const before = structuredClone(old);
  await expect(parseBackup(file)).rejects.toMatchObject({ code: 'size' });
  expect(old).toEqual(before);
}, 30_000);

const malformed: [string, (d: Dataset) => unknown][] = [
  ['schema', (d) => ({ ...d, schemaVersion: 99 })],
  ['boolean', (d) => ({ ...d, onboardingComplete: 1 })],
  ['revision fraction', (d) => ({ ...d, revision: 0.1 })],
  ['revision NaN', (d) => ({ ...d, revision: NaN })],
  ['revision negative', (d) => ({ ...d, revision: -1 })],
  ['settings language', (d) => ({ ...d, settings: { ...d.settings, language: 'PT' } })],
  ['settings bool', (d) => ({ ...d, settings: { ...d.settings, reducedMotion: 0 } })],
  [
    'remote registration',
    (d) => ({ ...d, settings: { ...d.settings, pushSubscription: { endpoint: 'remote' } } }),
  ],
  ['imported scores', (d) => ({ ...d, totalXp: 10000 })],
  [
    'empty ID',
    (d) => {
      d.habits[0].id = '  ';
      return d;
    },
  ],
  [
    'impossible date',
    (d) => {
      d.habits[0].createdOn = '2026-02-30';
      return d;
    },
  ],
  [
    'nonleap date',
    (d) => {
      d.habits[0].createdOn = '2025-02-29';
      return d;
    },
  ],
  [
    'unformatted date',
    (d) => {
      d.habits[0].createdOn = '2026-9-27';
      return d;
    },
  ],
  [
    'empty goal',
    (d) => {
      d.habits[0].versions[0].goal = '  ';
      return d;
    },
  ],
  [
    'empty mask',
    (d) => {
      d.habits[0].versions[0].weekdays = [];
      return d;
    },
  ],
  [
    'duplicate weekdays',
    (d) => {
      d.habits[0].versions[0].weekdays = [1, 1];
      return d;
    },
  ],
  [
    'fractional weekday',
    (d) => {
      d.habits[0].versions[0].weekdays = [1.5];
      return d;
    },
  ],
  [
    'weekday range',
    (d) => {
      d.habits[0].versions[0].weekdays = [7];
      return d;
    },
  ],
  [
    'extra habit prop',
    (d) => ({ ...d, habits: [{ ...d.habits[0], unknown: true }, ...d.habits.slice(1)] }),
  ],
  [
    'extra definition prop',
    (d) => ({
      ...d,
      habits: [
        { ...d.habits[0], versions: [{ ...d.habits[0].versions[0], pillarId: 'body' }] },
        ...d.habits.slice(1),
      ],
    }),
  ],
  [
    'extra period prop',
    (d) => ({
      ...d,
      habits: [
        { ...d.habits[0], periods: [{ ...d.habits[0].periods[0], unknown: true }] },
        ...d.habits.slice(1),
      ],
    }),
  ],
  [
    'extra pending prop',
    (d) => ({
      ...d,
      habits: [
        {
          ...d.habits[0],
          pendingReactivation: { periodId: 'x', requestedOn: '2026-10-02', start: '2026-10-05' },
        },
        ...d.habits.slice(1),
      ],
    }),
  ],
  [
    'invalid occurrence bool',
    (d) => ({ ...d, occurrences: [{ ...d.occurrences[0], done: 'true' }] }),
  ],
  ['invalid exemption bool', (d) => ({ ...d, occurrences: [{ ...d.occurrences[0], exempt: 1 }] })],
  [
    'invalid participation',
    (d) => ({ ...d, occurrences: [{ ...d.occurrences[0], pillarParticipation: 'optional' }] }),
  ],
  [
    'invalid provenance',
    (d) => ({
      ...d,
      occurrences: [{ ...d.occurrences[0], completionProvenance: 'completed-before' }],
    }),
  ],
  [
    'invalid offset',
    (d) => {
      d.occurrences[0].offsetMinutes = 0.5;
      return d;
    },
  ],
  [
    'out of range offset',
    (d) => {
      d.occurrences[0].offsetMinutes = 10000;
      return d;
    },
  ],
  [
    'invalid timestamp',
    (d) => {
      d.occurrences[0].recordedAt = '2026-02-30T12:00:00Z';
      return d;
    },
  ],
  [
    'timestamp rollover',
    (d) => {
      d.occurrences[0].recordedAt = '2026-10-02T24:00:00Z';
      return d;
    },
  ],
  [
    'missing timestamp zone',
    (d) => {
      d.occurrences[0].recordedAt = '2026-10-02T12:00:00';
      return d;
    },
  ],
  [
    'invalid timezone offset',
    (d) => {
      d.occurrences[0].recordedAt = '2026-10-02T12:00:00+99:00';
      return d;
    },
  ],
  [
    'blank timezone',
    (d) => {
      d.occurrences[0].timezone = ' ';
      return d;
    },
  ],
  [
    'unlock impossible timestamp',
    (d) => {
      d.permanentUnlocks[0].unlockedAt = '2026-02-30T12:00:00Z';
      return d;
    },
  ],
  ['draft bad step', (d) => ({ ...d, draft: { step: 6, goals: [] } })],
  ['draft fractional step', (d) => ({ ...d, draft: { step: 1.5, goals: [] } })],
  ['null habits', (d) => ({ ...d, habits: null })],
  [
    'absent required field',
    (d) => {
      const { draft: _draft, ...rest } = d;
      return rest;
    },
  ],
  [
    'undefined optional prop',
    (d) => ({ ...d, occurrences: [{ ...d.occurrences[0], exempt: undefined }] }),
  ],
];
test.each(malformed)('rejects malformed untrusted primitive/shape: %s', (_name, change) => {
  expect(() => validateDataset(change(fixture()))).toThrow(BackupError);
});
test.each([null, [], {}, 'not JSON', 42].map((raw) => ({ raw })))(
  'rejects unrelated datasets: $raw',
  ({ raw }) => expect(() => validateDataset(raw)).toThrow(BackupError),
);
test('archival metadata requires its eligible exempt fact instead of inventing a closed miss', () => {
  const data = fixture();
  const p = data.habits[0].periods[0];
  p.end = '2026-10-02';
  p.archivedOn = '2026-10-02';
  expect(() => validateDataset(data)).toThrow(BackupError);
  data.occurrences.push({
    ...data.occurrences[0],
    date: '2026-10-02',
    done: false,
    completionProvenance: 'never-credited',
    assignmentLocked: false,
    exempt: true,
  });
  expect(validateDataset(data)).toEqual(data);
  delete p.archivedOn;
  expect(() => validateDataset(data)).toThrow(BackupError);
});
test('legacy-unknown required rows cannot invent a conditional move participation', () => {
  const data = fixture();
  Object.assign(data.occurrences[0], {
    done: false,
    completionProvenance: 'legacy-unknown',
    pillarParticipation: 'on-completion',
  });
  expect(() => validateDataset(data)).toThrow(BackupError);
});

test('pending moves preserve conditional required commitment, destination timeline and exact intent', async () => {
  const data = fixture();
  const h = data.habits[0];
  h.pendingMove = { requestedOn: '2026-10-02', pillarId: 'body' };
  h.memberships.push({ effectiveFrom: '2026-10-05', pillarId: 'body' });
  data.occurrences.push({
    ...data.occurrences[0],
    date: '2026-10-02',
    done: false,
    pillarId: 'body',
    pillarParticipation: 'on-completion',
    completionProvenance: 'never-credited',
    assignmentLocked: false,
  });
  expect((await parseBackup(serializeBackup(data, now))).dataset).toEqual({ ...data, revision: 0 });
  expect(calculateProgress(data, '2026-10-04').totalXp).toBe(10);
  data.occurrences[1].done = true;
  data.occurrences[1].completionProvenance = 'credited';
  data.occurrences[1].assignmentLocked = true;
  expect(validateDataset(data)).toEqual(data);
  data.occurrences[1].done = false;
  expect(validateDataset(data)).toEqual(data);
});
test.each([
  ['before creation', { requestedOn: '2026-09-26', pillarId: 'body' }],
  ['invalid date', { requestedOn: '2026-02-30', pillarId: 'body' }],
  ['dangling target', { requestedOn: '2026-10-02', pillarId: 'absent' }],
  ['missing target', { requestedOn: '2026-10-02' }],
  ['extra field', { requestedOn: '2026-10-02', pillarId: 'body', effectiveFrom: '2026-10-05' }],
  ['invalid object', null],
])('invalid pending move %s is rejected', (_name, pendingMove) => {
  const data = fixture();
  expect(() =>
    validateDataset({
      ...data,
      habits: [{ ...data.habits[0], pendingMove }, ...data.habits.slice(1)],
    }),
  ).toThrow(BackupError);
});
test('pending move must match its resolved prospective destination membership', () => {
  const data = fixture();
  data.habits[0].pendingMove = { requestedOn: '2026-10-02', pillarId: 'body' };
  expect(() => validateDataset(data)).toThrow(BackupError);
  data.habits[0].memberships.push({ effectiveFrom: '2026-10-07', pillarId: 'body' });
  expect(() => validateDataset(data)).toThrow(BackupError);
});

test('future assigned dates are retained without current-date credit or a recordedAt/date equality rule', async () => {
  const data = fixture();
  data.occurrences.push({
    ...data.occurrences[0],
    date: '2026-10-05',
    recordedAt: '2026-10-04T23:59:59-03:00',
  });
  expect((await parseBackup(serializeBackup(data, now))).dataset).toEqual({ ...data, revision: 0 });
  expect(calculateProgress(data, '2026-10-04').totalXp).toBe(10);
  expect(calculateProgress(data, '2026-10-05').totalXp).toBe(20);
});
test('a complete creation-day opportunity remains optional even off schedule', async () => {
  const data = fixture();
  Object.assign(data.occurrences[0], {
    date: '2026-09-27',
    kind: 'optional',
    pillarParticipation: 'on-completion',
  });
  expect((await parseBackup(serializeBackup(data, now))).dataset).toEqual({ ...data, revision: 0 });
  expect(calculateProgress(data, '2026-09-27').totalXp).toBe(10);
});
test('opaque identifiers resembling prototype keys are preserved as facts', async () => {
  const data = fixture();
  data.habits[0].id = '__proto__';
  data.occurrences[0].habitId = '__proto__';
  data.pillars[4].id = 'constructor';
  data.occurrences[0].pillarId = 'constructor';
  expect((await parseBackup(serializeBackup(data, now))).dataset).toEqual({ ...data, revision: 0 });
  expect(calculateProgress(data, '2026-10-04').totalXp).toBe(10);
});

test('rejects malformed envelopes and invalid export clocks', async () => {
  const valid = JSON.parse(await envelope(fixture()).text());
  const bad = [
    { ...valid, format: 'other' },
    { ...valid, formatVersion: 2 },
    { ...valid, exportedAt: '2026-02-30T12:00:00Z' },
    { ...valid, unknown: true },
    fixture(),
  ];
  for (const raw of bad)
    await expect(parseBackup(new Blob([JSON.stringify(raw)]))).rejects.toMatchObject({
      code: 'invalid',
    });
  await expect(parseBackup(new Blob(['{ broken JSON']))).rejects.toMatchObject({ code: 'invalid' });
  expect(() => serializeBackup(fixture(), new Date('invalid'))).toThrow(BackupError);
});
