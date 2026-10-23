import {
  DEFAULT_PILLARS,
  type ActivationPeriod,
  type Dataset,
  type DatasetFacts,
  type OnboardingDraft,
  type OnboardingGoal,
  type Habit,
  type HabitVersion,
  type LegacyDataset,
  type MembershipVersion,
  type Occurrence,
  type OccurrenceSnapshot,
  type Pillar,
} from '../domain/types';
import { migrateDataset } from './migrations';
import {
  activationAt,
  definitionAt,
  nextHabitScheduledDate,
  pendingReactivationDate,
} from '../domain/agenda';
import { parseLocalDate, weekday } from '../domain/calendar';
import { calculateProgress } from '../domain/progress';
import { pillarHasProspectiveHabits } from '../domain/pillars';
import { progressIntervalOrDefault } from '../domain/preferences';

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
// Internal-only rule/schema metadata: never include diary values or exception causes.
export interface BackupDiagnostic {
  readonly rule:
    | 'definition-timeline'
    | 'membership-timeline'
    | 'activation-identity-unique'
    | 'occurrence-reference'
    | 'occurrence-context'
    | 'occurrence-schedule'
    | 'occurrence-credit';
  readonly location:
    | 'habits.versions'
    | 'habits.memberships'
    | 'habits'
    | 'occurrences'
    | 'occurrences.completionProvenance';
}

export class BackupError extends Error {
  constructor(
    public readonly code: 'invalid' | 'size',
    message = code === 'size'
      ? 'Backup exceeds the supported 20 MiB limit'
      : 'Invalid or unsupported backup',
    public readonly diagnostic?: BackupDiagnostic,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

function invalid(diagnostic?: BackupDiagnostic): never {
  throw new BackupError('invalid', undefined, diagnostic);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    invalid();
  return value;
}

function text(value: unknown, nonblank = false): string {
  if (typeof value !== 'string' || (nonblank && !value.trim())) invalid();
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    invalid();
  return value;
}

function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) invalid();
  return value.map(parse);
}

function mask(value: unknown, incomplete = false): number[] {
  const days = list(value, (day) => integer(day, 0, 6));
  if ((!incomplete && !days.length) || new Set(days).size !== days.length) invalid();
  return days;
}

function date(value: unknown): string {
  const result = text(value);
  parseLocalDate(result);
  return result;
}

function timestamp(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result))
    invalid();
  date(result.slice(0, 10));
  const hours = Number(result.slice(11, 13));
  const minutes = Number(result.slice(14, 16));
  const seconds = Number(result.slice(17, 19));
  if (hours > 23 || minutes > 59 || seconds > 59 || !Number.isFinite(Date.parse(result))) invalid();
  if (!result.endsWith('Z') && (Number(result.slice(-5, -3)) > 23 || Number(result.slice(-2)) > 59))
    invalid();
  return result;
}

function pillar(raw: unknown): Pillar {
  const r = record(raw, ['id', 'name'], ['defaultKey', 'nameOverride', 'removedOn']);
  const p: Pillar = { id: text(r.id, true), name: text(r.name, true) };
  if (Object.hasOwn(r, 'nameOverride')) p.nameOverride = text(r.nameOverride, true);
  if (Object.hasOwn(r, 'removedOn')) p.removedOn = date(r.removedOn);
  if (Object.hasOwn(r, 'defaultKey')) {
    const key = r.defaultKey;
    if (key !== 'mind' && key !== 'body' && key !== 'nutrition' && key !== 'hygiene') invalid();
    p.defaultKey = key;
  }
  return p;
}

function definition(raw: unknown): HabitVersion {
  const r = record(raw, ['effectiveFrom', 'goal', 'weekdays']);
  return {
    effectiveFrom: date(r.effectiveFrom),
    goal: text(r.goal, true),
    weekdays: mask(r.weekdays),
  };
}

function membership(raw: unknown): MembershipVersion {
  const r = record(raw, ['effectiveFrom', 'pillarId']);
  return { effectiveFrom: date(r.effectiveFrom), pillarId: text(r.pillarId, true) };
}

function period(raw: unknown): ActivationPeriod {
  const r = record(raw, ['id', 'start'], ['end', 'archivedOn', 'reactivatedOn']);
  const p: ActivationPeriod = { id: text(r.id, true), start: date(r.start) };
  if (Object.hasOwn(r, 'end')) p.end = date(r.end);
  if (Object.hasOwn(r, 'archivedOn')) p.archivedOn = date(r.archivedOn);
  if (Object.hasOwn(r, 'reactivatedOn')) p.reactivatedOn = date(r.reactivatedOn);
  return p;
}

function habit(raw: unknown): Habit {
  const r = record(
    raw,
    ['id', 'createdOn', 'versions', 'memberships', 'periods'],
    ['pendingReactivation', 'pendingMove'],
  );
  const h: Habit = {
    id: text(r.id, true),
    createdOn: date(r.createdOn),
    versions: list(r.versions, definition),
    memberships: list(r.memberships, membership),
    periods: list(r.periods, period),
  };
  if (Object.hasOwn(r, 'pendingReactivation')) {
    const p = record(r.pendingReactivation, ['periodId', 'requestedOn']);
    h.pendingReactivation = { periodId: text(p.periodId, true), requestedOn: date(p.requestedOn) };
  }
  if (Object.hasOwn(r, 'pendingMove')) {
    const p = record(r.pendingMove, ['requestedOn', 'pillarId']);
    h.pendingMove = { requestedOn: date(p.requestedOn), pillarId: text(p.pillarId, true) };
  }
  return h;
}

const snapshotKeys = [
  'habitId',
  'date',
  'pillarId',
  'goal',
  'kind',
  'done',
  'recordedAt',
  'timezone',
  'offsetMinutes',
];

function snapshot(r: Record<string, unknown>): OccurrenceSnapshot {
  const kind = r.kind;
  if (kind !== 'optional' && kind !== 'required') invalid();
  return {
    habitId: text(r.habitId, true),
    date: date(r.date),
    pillarId: text(r.pillarId, true),
    goal: text(r.goal, true),
    kind,
    done: bool(r.done),
    recordedAt: timestamp(r.recordedAt),
    timezone: text(r.timezone, true),
    offsetMinutes: integer(r.offsetMinutes, -1440, 1440),
  };
}

function occurrence(raw: unknown): Occurrence {
  const r = record(
    raw,
    [
      ...snapshotKeys,
      'activationId',
      'pillarParticipation',
      'completionProvenance',
      'assignmentLocked',
    ],
    ['exempt'],
  );
  const participation = r.pillarParticipation;
  const provenance = r.completionProvenance;
  if (participation !== 'required' && participation !== 'on-completion') invalid();
  if (
    provenance !== 'never-credited' &&
    provenance !== 'credited' &&
    provenance !== 'legacy-unknown'
  )
    invalid();
  const o: Occurrence = {
    ...snapshot(r),
    activationId: text(r.activationId, true),
    pillarParticipation: participation,
    completionProvenance: provenance,
    assignmentLocked: bool(r.assignmentLocked),
  };
  if (Object.hasOwn(r, 'exempt')) o.exempt = bool(r.exempt);
  return o;
}

function goal(raw: unknown): OnboardingGoal {
  const r = record(raw, ['pillarId', 'goal', 'weekdays'], ['configured']);
  const result: OnboardingGoal = {
    pillarId: text(r.pillarId, true),
    goal: text(r.goal),
    weekdays: mask(r.weekdays, true),
  };
  if (Object.hasOwn(r, 'configured')) result.configured = bool(r.configured);
  return result;
}

function unique(ids: string[], diagnostic?: BackupDiagnostic): void {
  if (new Set(ids).size !== ids.length) invalid(diagnostic);
}

function ordered(
  history: { effectiveFrom: string }[],
  createdOn: string,
  diagnostic?: BackupDiagnostic,
): void {
  if (
    !history.length ||
    history[0].effectiveFrom !== createdOn ||
    history.some((v, i) => i > 0 && history[i - 1].effectiveFrom >= v.effectiveFrom)
  )
    invalid(diagnostic);
}

/** Validate relationships only after all primitive values have been reconstructed. */
function validateFacts(data: Dataset): void {
  if (
    data.onboardingComplete
      ? data.draft !== null
      : data.habits.length > 0 || data.occurrences.length > 0
  )
    invalid();
  unique(data.pillars.map((p) => p.id));
  unique(data.habits.map((h) => h.id));
  unique(data.permanentUnlocks.map((u) => u.id));
  const pillars = new Set(data.pillars.map((p) => p.id));
  for (const key of DEFAULT_PILLARS)
    if (!data.pillars.some((p) => p.id === key && p.defaultKey === key)) invalid();
  for (const p of data.pillars) if (p.defaultKey !== undefined && p.defaultKey !== p.id) invalid();
  if (data.draft) {
    if (data.draft.goals.length > 4) invalid();
    unique(data.draft.goals.map((g) => g.pillarId));
    if (data.draft.goals.some((g) => !pillars.has(g.pillarId))) invalid();
  }
  const identities: string[] = [];
  for (const h of data.habits) {
    ordered(h.versions, h.createdOn, {
      rule: 'definition-timeline',
      location: 'habits.versions',
    });
    ordered(h.memberships, h.createdOn, {
      rule: 'membership-timeline',
      location: 'habits.memberships',
    });
    if (
      h.memberships.some((m) => !pillars.has(m.pillarId)) ||
      !h.periods.length ||
      h.periods[0].start !== h.createdOn
    )
      invalid();
    h.periods.forEach((p, i) => {
      identities.push(p.id);
      if (p.end !== undefined && p.end < p.start) invalid();
      if (p.archivedOn !== undefined && p.archivedOn !== p.end) invalid();
      if (i > 0) {
        const previous = h.periods[i - 1];
        if (!previous.end || p.start <= previous.end) invalid();
      }
      if (p.reactivatedOn !== undefined) {
        if (i === 0 || p.reactivatedOn >= p.start || p.reactivatedOn < h.periods[i - 1].end!)
          invalid();
        const projected: Habit = {
          ...h,
          pendingReactivation: { periodId: p.id, requestedOn: p.reactivatedOn },
        };
        if (pendingReactivationDate(projected) !== p.start) invalid();
      }
    });
    if (h.pendingMove) {
      const move = h.pendingMove;
      if (move.requestedOn < h.createdOn || !pillars.has(move.pillarId)) invalid();
      const due = nextHabitScheduledDate(h, move.requestedOn);
      if (
        due <= move.requestedOn ||
        !h.memberships.some((m) => m.effectiveFrom === due && m.pillarId === move.pillarId)
      )
        invalid();
    }
    if (h.pendingReactivation) {
      identities.push(h.pendingReactivation.periodId);
      const end = h.periods.at(-1)!.end;
      if (!end || h.pendingReactivation.requestedOn < end) invalid();
      const start = pendingReactivationDate(h);
      if (!start || start <= h.pendingReactivation.requestedOn || start <= end) invalid();
    }
  }
  // Removal is portable history: apply the management occupancy contract at
  // each stored removal date, never at the importing device's current date.
  for (const p of data.pillars) {
    if (p.removedOn && pillarHasProspectiveHabits(data, p.id, p.removedOn)) invalid();
  }
  unique(identities, { rule: 'activation-identity-unique', location: 'habits' });
  unique(data.occurrences.map((o) => JSON.stringify([o.habitId, o.date])));
  const habits = new Map(data.habits.map((h) => [h.id, h]));
  for (const o of data.occurrences) {
    const h = habits.get(o.habitId);
    if (!h || !pillars.has(o.pillarId))
      invalid({ rule: 'occurrence-reference', location: 'occurrences' });
    const p = activationAt(h, o.date);
    const v = definitionAt(h, o.date);
    if (!p || p.id !== o.activationId || !v || o.date < h.createdOn)
      invalid({ rule: 'occurrence-context', location: 'occurrences' });
    if (o.date === h.createdOn) {
      if (o.kind !== 'optional' || o.pillarParticipation !== 'on-completion') invalid();
    } else if (o.kind !== 'required' || !v.weekdays.includes(weekday(o.date)))
      invalid({ rule: 'occurrence-schedule', location: 'occurrences' });
    if (o.completionProvenance === 'never-credited') {
      if (o.done || o.assignmentLocked)
        invalid({ rule: 'occurrence-credit', location: 'occurrences.completionProvenance' });
    } else if (!o.assignmentLocked || (o.completionProvenance === 'legacy-unknown' && o.done))
      invalid({ rule: 'occurrence-credit', location: 'occurrences.completionProvenance' });
    // Archive may mark both retained Done and exempt unfinished facts; Undo keeps it.
    if (o.exempt && (p.end !== o.date || p.archivedOn !== o.date)) invalid();
    if (
      o.kind === 'required' &&
      o.completionProvenance === 'legacy-unknown' &&
      o.pillarParticipation !== 'required'
    )
      invalid();
  }
  for (const h of data.habits)
    for (const p of h.periods) {
      if (!p.archivedOn) continue;
      const v = definitionAt(h, p.archivedOn);
      const eligible = p.archivedOn === h.createdOn || v?.weekdays.includes(weekday(p.archivedOn));
      if (
        eligible &&
        !data.occurrences.some((o) => o.habitId === h.id && o.date === p.archivedOn && o.exempt)
      )
        invalid();
    }
  // No imported totals/ledger exist. Exercise the same authoritative replay used by UI;
  // choose a stored date, never another device's current date or a fabricated completion.
  const replayDate = [
    ...data.habits.map((h) => h.createdOn),
    ...data.occurrences.map((o) => o.date),
  ]
    .sort()
    .at(-1);
  if (replayDate) calculateProgress(data, replayDate);
}

/** Reconstruct supported JSON values; never cast an imported object to a domain type. */
export function validateDataset(raw: unknown): Dataset {
  try {
    const r = record(
      raw,
      [
        'schemaVersion',
        'onboardingComplete',
        'draft',
        'settings',
        'pillars',
        'habits',
        'occurrences',
        'permanentUnlocks',
      ],
      ['revision'],
    );
    if (r.schemaVersion !== 1 && r.schemaVersion !== 2) invalid();
    const s = record(r.settings, ['language', 'reducedMotion'], ['progressInterval']);
    const language = s.language;
    if (language !== 'en' && language !== 'pt') invalid();
    const draft =
      r.draft === null
        ? null
        : (() => {
            const d = record(r.draft, ['step', 'goals'], ['editingReview']);
            const step = integer(d.step, 0, 5);
            const goals = list(d.goals, goal);
            unique(goals.map((g) => g.pillarId));
            if (goals.some((g) => !DEFAULT_PILLARS.some((id) => id === g.pillarId))) invalid();
            const result: OnboardingDraft = {
              step,
              goals: DEFAULT_PILLARS.map(
                (pillarId) =>
                  goals.find((g) => g.pillarId === pillarId) ?? {
                    pillarId,
                    goal: '',
                    weekdays: [0, 1, 2, 3, 4, 5, 6],
                  },
              ),
            };
            if (Object.hasOwn(d, 'editingReview')) result.editingReview = bool(d.editingReview);
            return result;
          })();
    const facts: DatasetFacts = {
      onboardingComplete: bool(r.onboardingComplete),
      draft,
      settings: {
        language,
        reducedMotion: bool(s.reducedMotion),
        ...(Object.hasOwn(s, 'progressInterval')
          ? { progressInterval: progressIntervalOrDefault(s.progressInterval) }
          : {}),
      },
      pillars: list(r.pillars, pillar),
      permanentUnlocks: list(r.permanentUnlocks, (raw) => {
        const u = record(raw, ['id', 'unlockedAt']);
        return { id: text(u.id, true), unlockedAt: timestamp(u.unlockedAt) };
      }),
    };
    let result: Dataset;
    if (r.schemaVersion === 1) {
      if (Object.hasOwn(r, 'revision')) invalid();
      const legacy: LegacyDataset = {
        ...facts,
        schemaVersion: 1,
        habits: list(r.habits, (raw) => {
          const h = record(raw, ['id', 'createdOn', 'versions', 'periods']);
          return {
            id: text(h.id, true),
            createdOn: date(h.createdOn),
            periods: list(h.periods, period),
            versions: list(h.versions, (raw) => {
              const v = record(raw, ['effectiveFrom', 'goal', 'weekdays', 'pillarId']);
              return {
                effectiveFrom: date(v.effectiveFrom),
                goal: text(v.goal, true),
                weekdays: mask(v.weekdays),
                pillarId: text(v.pillarId, true),
              };
            }),
          };
        }),
        occurrences: list(r.occurrences, (raw) => snapshot(record(raw, snapshotKeys))),
      };
      result = migrateDataset(legacy);
    } else
      result = {
        ...facts,
        schemaVersion: 2,
        revision: Object.hasOwn(r, 'revision')
          ? integer(r.revision, 0, Number.MAX_SAFE_INTEGER)
          : 0,
        habits: list(r.habits, habit),
        occurrences: list(r.occurrences, occurrence),
      };
    validateFacts(result);
    return result;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    invalid();
  }
}

function serializeAt(data: Dataset, exportedAt: string): Blob {
  const { revision: _localRevision, ...portable } = data;
  const blob = new Blob(
    [
      JSON.stringify({
        format: 'my-goat-journey-backup',
        formatVersion: 1,
        exportedAt,
        dataset: portable,
      }),
    ],
    { type: 'application/json' },
  );
  if (blob.size > MAX_BACKUP_BYTES) throw new BackupError('size');
  return blob;
}

export function serializeBackup(data: Dataset, now = new Date()): Blob {
  try {
    return serializeAt(validateDataset(data), timestamp(now.toISOString()));
  } catch (error) {
    if (error instanceof BackupError) throw error;
    invalid();
  }
}

export async function parseBackup(file: Blob): Promise<{ dataset: Dataset; exportedAt: string }> {
  if (file.size > MAX_BACKUP_BYTES) throw new BackupError('size');
  try {
    const bytes = await file.arrayBuffer();
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const r = record(JSON.parse(decoded), ['format', 'formatVersion', 'exportedAt', 'dataset']);
    if (r.format !== 'my-goat-journey-backup' || r.formatVersion !== 1) invalid();
    const exportedAt = timestamp(r.exportedAt);
    const dataset = validateDataset(r.dataset);
    serializeAt(dataset, exportedAt);
    return { dataset, exportedAt };
  } catch (error) {
    if (error instanceof BackupError) throw error;
    invalid();
  }
}
