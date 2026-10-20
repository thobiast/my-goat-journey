import type { Dataset } from './types';

/** Own an id once per dataset; callers evaluate reviewed conditions independently of XP. */
export function grantPermanentUnlock(data: Dataset, id: string, now: Date): void {
  if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid unlock id');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error('Invalid unlock time');
  if (!data.permanentUnlocks.some((unlock) => unlock.id === id)) {
    data.permanentUnlocks.push({ id, unlockedAt: now.toISOString() });
  }
}
