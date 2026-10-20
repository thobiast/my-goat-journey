import {
  DEFAULT_PILLARS,
  type CompatibleDataset,
  type Dataset,
  type GoalInput,
  type LocalDate,
  type OnboardingDraft,
  type Settings,
} from '../domain/types';
import { updateCompletion } from '../domain/completion';
import {
  archiveHabit,
  editHabit,
  pendingMoveDate,
  reactivateHabit,
  reactivateHabitInPillar,
  reconcileHabit,
} from '../domain/lifecycle';
import { newIdentity } from '../domain/identity';
import { DatasetError } from '../domain/errors';
import { makeHabit } from '../domain/creation';
import { isProgressInterval } from '../domain/preferences';
import { configuredOnboardingGoals } from '../domain/onboarding';
import { grantPermanentUnlock } from '../domain/unlocks';
import { migrateDataset } from './migrations';
import { validateDataset } from './backup';
import { pendingReactivationDate } from '../domain/agenda';
import { localDate, parseLocalDate } from '../domain/calendar';
import { pillarHasProspectiveHabits } from '../domain/pillars';

function initialDataset(): Dataset {
  return {
    schemaVersion: 2,
    revision: 0,
    onboardingComplete: false,
    draft: null,
    settings: { language: 'en', reducedMotion: false },
    pillars: DEFAULT_PILLARS.map((id) => ({ id, name: id, defaultKey: id })),
    habits: [],
    occurrences: [],
    permanentUnlocks: [],
  };
}

function factsKey(value: unknown): string {
  function ordered(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(ordered);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, ordered(entry)]),
      );
    }
    return input;
  }

  return JSON.stringify(ordered(value));
}

export class Repository {
  private connection?: Promise<IDBDatabase>;
  constructor(
    public name = 'my-goat-journey',
    private failWrite?: () => boolean,
  ) {}
  private open(): Promise<IDBDatabase> {
    if (!this.connection)
      this.connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('dataset');
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.connection = undefined;
          };
          resolve(db);
        };
        request.onerror = () => {
          this.connection = undefined;
          reject(request.error);
        };
        request.onblocked = () => {
          this.connection = undefined;
          reject(new Error('Database upgrade blocked'));
        };
      });
    return this.connection;
  }
  private async transact(
    update?: (data: Dataset) => void,
    expectedRevision?: number,
    today = localDate(new Date()),
    replacement?: Dataset,
  ): Promise<Dataset> {
    parseLocalDate(today);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('dataset', 'readwrite');
      const store = tx.objectStore('dataset');
      let data: Dataset;
      let failure: unknown;
      tx.oncomplete = () => resolve(data);
      tx.onabort = () => reject(failure || tx.error || new Error('Persistence failed'));
      tx.onerror = () => {
        failure ||= tx.error;
      };
      const request = store.get('current');
      request.onsuccess = () => {
        try {
          const stored = request.result;
          data = stored ? migrateDataset(stored) : initialDataset();
          if (expectedRevision !== undefined && expectedRevision !== data.revision)
            throw new DatasetError('stale-revision');
          const before = factsKey(data);
          if (replacement) {
            // Revalidate inside the serialized transaction before touching committed facts.
            const revision = data.revision;
            data = structuredClone(validateDataset(replacement));
            data.revision = revision;
          } else {
            for (const habit of data.habits) reconcileHabit(habit, today);
            update?.(data);
          }
          const changed = before !== factsKey(data);
          if (!stored || stored.schemaVersion !== 2 || changed || replacement) {
            if (changed || replacement) {
              if (!Number.isSafeInteger(data.revision + 1))
                throw new Error('Dataset revision exhausted');
              data.revision++;
            }
            if (this.failWrite?.()) throw new Error('Persistence failed');
            store.put(data, 'current');
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }
  async load(now = new Date(), expectedRevision?: number): Promise<Dataset> {
    const today = localDate(now);
    parseLocalDate(today);
    const db = await this.open();
    const stored = await new Promise<CompatibleDataset | undefined>((resolve, reject) => {
      const tx = db.transaction('dataset', 'readonly');
      const request = tx.objectStore('dataset').get('current');
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error('Persistence failed'));
    });
    if (
      expectedRevision !== undefined &&
      stored?.schemaVersion === 2 &&
      stored.revision !== expectedRevision
    )
      throw new DatasetError('stale-revision');
    const needsReconciliation =
      stored?.schemaVersion === 2 &&
      stored.habits.some((h) => {
        const start = pendingReactivationDate(h);
        const move = pendingMoveDate(h);
        return (start !== undefined && start <= today) || (move !== undefined && move <= today);
      });
    return stored?.schemaVersion === 2 && !needsReconciliation
      ? stored
      : this.transact(undefined, expectedRevision, today);
  }
  async saveDraft(draft: OnboardingDraft, expectedRevision?: number): Promise<Dataset> {
    return this.transact((data) => {
      if (!data.onboardingComplete) {
        // Validate structure/metadata, not readiness: partial text and empty masks are drafts.
        validateDataset({ ...data, draft });
        data.draft = structuredClone(draft);
      }
    }, expectedRevision);
  }
  async finalize(today: LocalDate, expectedRevision?: number): Promise<Dataset> {
    return this.transact(
      (data) => {
        if (data.onboardingComplete) return;
        const draft = validateDataset(data).draft;
        const goals = draft ? configuredOnboardingGoals(draft) : [];
        if (!goals.length) throw new Error('Configure at least one habit');
        data.habits = goals.map((input) => makeHabit(input, today, data));
        data.onboardingComplete = true;
        data.draft = null;
      },
      expectedRevision,
      today,
    );
  }
  async createHabit(
    input: GoalInput,
    today: LocalDate,
    expectedRevision?: number,
  ): Promise<Dataset> {
    return this.transact(
      (data) => {
        if (!data.onboardingComplete) throw new Error('Complete setup first');
        data.habits.push(makeHabit(input, today, data));
      },
      expectedRevision,
      today,
    );
  }
  async editHabit(
    habitId: string,
    input: GoalInput,
    now: Date,
    expectedRevision?: number,
  ): Promise<Dataset> {
    return this.transact(
      (data) => editHabit(data, habitId, input, now),
      expectedRevision,
      localDate(now),
    );
  }
  async archiveHabit(habitId: string, now: Date, expectedRevision?: number): Promise<Dataset> {
    return this.transact(
      (data) => archiveHabit(data, habitId, now),
      expectedRevision,
      localDate(now),
    );
  }
  async reactivateHabit(habitId: string, now: Date, expectedRevision?: number): Promise<Dataset> {
    return this.transact(
      (data) => reactivateHabit(data, habitId, now),
      expectedRevision,
      localDate(now),
    );
  }
  async reactivateHabitInPillar(
    habitId: string,
    pillarId: string,
    now: Date,
    expectedRevision?: number,
  ): Promise<Dataset> {
    return this.transact(
      (data) => reactivateHabitInPillar(data, habitId, pillarId, now),
      expectedRevision,
      localDate(now),
    );
  }
  async createPillar(name: string, expectedRevision?: number): Promise<Dataset> {
    return this.transact((data) => {
      if (!name.trim()) throw new Error('Enter a pillar name');
      data.pillars.push({ id: newIdentity(), name });
    }, expectedRevision);
  }
  async removePillar(pillarId: string, now: Date, expectedRevision?: number): Promise<Dataset> {
    return this.transact(
      (data) => {
        const pillar = data.pillars.find((p) => p.id === pillarId);
        if (!pillar) throw new Error('Unknown pillar');
        const today = localDate(now);
        if (pillarHasProspectiveHabits(data, pillarId, today))
          throw new Error('Move or archive all habits first');
        if (!pillar.removedOn) pillar.removedOn = today;
      },
      expectedRevision,
      localDate(now),
    );
  }
  async renamePillar(pillarId: string, name: string, expectedRevision?: number): Promise<Dataset> {
    return this.transact((data) => {
      const pillar = data.pillars.find((p) => p.id === pillarId);
      if (!pillar) throw new Error('Unknown pillar');
      if (!name.trim()) throw new Error('Enter a pillar name');
      if (pillar.defaultKey) pillar.nameOverride = name;
      else pillar.name = name;
    }, expectedRevision);
  }
  async setDone(
    habitId: string,
    date: LocalDate,
    done: boolean,
    now: Date,
    expectedRevision?: number,
  ): Promise<Dataset> {
    return this.transact(
      (data) => updateCompletion(data, habitId, date, done, now),
      expectedRevision,
      localDate(now),
    );
  }
  async setSettings(patch: Partial<Settings>, expectedRevision?: number): Promise<Dataset> {
    return this.transact((data) => {
      if (patch.language !== undefined && patch.language !== 'en' && patch.language !== 'pt')
        throw new Error('Invalid language');
      if (patch.reducedMotion !== undefined && typeof patch.reducedMotion !== 'boolean')
        throw new Error('Invalid accessibility setting');
      if (Object.hasOwn(patch, 'progressInterval') && !isProgressInterval(patch.progressInterval))
        throw new Error('Invalid Progress interval');
      data.settings = { ...data.settings, ...patch };
    }, expectedRevision);
  }
  async grantPermanentUnlock(id: string, now: Date, expectedRevision?: number): Promise<Dataset> {
    return this.transact((data) => grantPermanentUnlock(data, id, now), expectedRevision);
  }
  async replaceDataset(
    candidate: Dataset,
    expectedRevision: number,
    now = new Date(),
  ): Promise<Dataset> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error('Invalid expected revision');
    const replacement = validateDataset(candidate);
    return this.transact(undefined, expectedRevision, localDate(now), replacement);
  }
  async resetDataset(expectedRevision: number, now = new Date()): Promise<Dataset> {
    return this.replaceDataset(initialDataset(), expectedRevision, now);
  }
  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (connection) (await connection).close();
  }
}
