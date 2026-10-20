export function legacyFixture() {
  return {
    schemaVersion: 1 as const,
    onboardingComplete: true,
    draft: {
      step: 2,
      goals: [{ pillarId: 'music', goal: '  Preserve my text 🎵  ', weekdays: [1, 3, 5] }],
    },
    settings: { language: 'pt' as const, reducedMotion: true },
    pillars: [
      { id: 'music', name: 'My music' },
      { id: 'body', name: 'Body' },
    ],
    habits: [
      {
        id: 'read',
        createdOn: '2026-09-27',
        versions: [
          {
            effectiveFrom: '2026-09-27',
            goal: 'Original goal',
            weekdays: [1, 3, 5],
            pillarId: 'music',
          },
          { effectiveFrom: '2026-10-01', goal: 'New goal', weekdays: [1, 3, 5], pillarId: 'body' },
        ],
        periods: [{ id: 'first', start: '2026-09-27' }],
      },
    ],
    occurrences: [
      {
        habitId: 'read',
        date: '2026-09-27',
        pillarId: 'music',
        goal: 'Optional original',
        kind: 'optional' as const,
        done: true,
        recordedAt: '2026-09-27T23:00:00Z',
        timezone: 'UTC',
        offsetMinutes: 0,
      },
      {
        habitId: 'read',
        date: '2026-09-30',
        pillarId: 'music',
        goal: 'Frozen historical goal',
        kind: 'required' as const,
        done: true,
        recordedAt: '2026-10-02T12:00:00Z',
        timezone: 'UTC',
        offsetMinutes: 0,
      },
      {
        habitId: 'read',
        date: '2026-10-02',
        pillarId: 'music',
        goal: 'False frozen snapshot',
        kind: 'required' as const,
        done: false,
        recordedAt: '2026-10-02T12:00:00Z',
        timezone: 'UTC',
        offsetMinutes: 0,
      },
    ],
    permanentUnlocks: [{ id: 'opaque-item', unlockedAt: '2026-09-30T12:00:00Z' }],
  };
}

export async function seed(name: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('dataset');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('dataset', 'readwrite');
    tx.objectStore('dataset').put(value, 'current');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function stored(name: string): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const r = indexedDB.open(name, 1);
    r.onsuccess = () => resolve(r.result);
  });
  const result = await new Promise((resolve) => {
    const r = db.transaction('dataset').objectStore('dataset').get('current');
    r.onsuccess = () => resolve(r.result);
  });
  db.close();
  return result;
}
