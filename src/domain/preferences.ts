import type { ProgressInterval } from './types';

export const PROGRESS_INTERVALS = ['7d', '1m', '3m', '12m', '24m'] as const;

export function isProgressInterval(value: unknown): value is ProgressInterval {
  return PROGRESS_INTERVALS.some((interval) => interval === value);
}

/** Only the selected interval is portable; calendar windows remain derived state. */
export function progressIntervalOrDefault(value: unknown): ProgressInterval {
  return isProgressInterval(value) ? value : '7d';
}
