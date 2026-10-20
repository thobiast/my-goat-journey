import type { CompatibleDataset, Dataset } from '../domain/types';

/** Normalize supported stored facts in memory. Persistence belongs to Repository. */
export function migrateDataset(input: CompatibleDataset): Dataset {
  if (input.schemaVersion === 2) return input;
  if (input.schemaVersion !== 1) throw new Error('Unsupported dataset schema');
  const old = structuredClone(input);
  const habits = old.habits.map((habit) => ({
    ...habit,
    versions: habit.versions.map(({ effectiveFrom, goal, weekdays }) => ({
      effectiveFrom,
      goal,
      weekdays,
    })),
    memberships: habit.versions.map(({ effectiveFrom, pillarId }) => ({ effectiveFrom, pillarId })),
  }));
  const keys = new Set<string>();
  const occurrences = old.occurrences.map((occurrence) => {
    const key = JSON.stringify([occurrence.habitId, occurrence.date]);
    if (keys.has(key)) throw new Error('Duplicate habit/date occurrence');
    keys.add(key);
    const habit = habits.find((h) => h.id === occurrence.habitId);
    const period = habit?.periods.find(
      (p) => occurrence.date >= p.start && (!p.end || occurrence.date <= p.end),
    );
    if (!period) throw new Error('Occurrence outside activation period');
    return {
      ...occurrence,
      activationId: period.id,
      pillarParticipation:
        occurrence.kind === 'required' ? ('required' as const) : ('on-completion' as const),
      completionProvenance: occurrence.done ? ('credited' as const) : ('legacy-unknown' as const),
      assignmentLocked: true,
    };
  });
  return { ...old, schemaVersion: 2, revision: 1, habits, occurrences };
}
