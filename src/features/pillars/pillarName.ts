import type { Pillar } from '../../domain/types';
import type { Copy } from '../habits/GoalFields';

/** Explicit user names never change when switching interface language. */
export const pillarName = (pillar: Pillar | undefined, copy: Copy) =>
  pillar?.nameOverride ?? (pillar?.defaultKey ? copy[pillar.defaultKey] : (pillar?.name ?? ''));
