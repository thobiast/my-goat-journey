import { assertType, test } from 'vitest';
import type { Route } from '../../src/app/routes';

// These assertions are checked by the ordinary TypeScript gate, not just Vitest.
test('routes require their screen context and reject unrelated parameters', () => {
  const scope = { kind: 'all' } as const;
  const date = '2026-10-19';
  const window = { start: date, end: date, historyEnd: date };

  assertType<Route>({ screen: 'progressDay', scope, date, window });
  // @ts-expect-error Day details need the selected period for bounded day navigation.
  assertType<Route>({ screen: 'progressDay', scope, date });
  // @ts-expect-error Day details need a historical date.
  assertType<Route>({ screen: 'progressDay', scope, window });
  // @ts-expect-error Day details need their original calendar scope.
  assertType<Route>({ screen: 'progressDay', date, window });
  // @ts-expect-error An editor cannot operate without a habit identity.
  assertType<Route>({ screen: 'editHabit' });
  // @ts-expect-error A lifecycle prompt must specify the requested action.
  assertType<Route>({ screen: 'habitAction', habitId: 'habit' });
  // @ts-expect-error Removal needs a pillar identity.
  assertType<Route>({ screen: 'removePillar' });
  // @ts-expect-error Habit creation needs its initial destination.
  assertType<Route>({ screen: 'habit' });
  // @ts-expect-error Habit review needs a habit identity.
  assertType<Route>({ screen: 'habitDetail' });
  // @ts-expect-error Pillar history needs a pillar identity.
  assertType<Route>({ screen: 'pillarHistory' });
  // @ts-expect-error A primary destination does not accept habit parameters.
  assertType<Route>({ screen: 'today', habitId: 'habit' });
  // @ts-expect-error Move intent belongs to the editor, not habit review.
  assertType<Route>({ screen: 'habitDetail', habitId: 'habit', move: true });
  const unrelatedOrigin = { screen: 'progress', scope } as const;
  // @ts-expect-error Captured destinations must also exclude other screens' context.
  assertType<Route>(unrelatedOrigin);

  assertType<Route>({ screen: 'pillar' });
  assertType<Route>({ screen: 'pillar', pillarId: 'pillar' });
  assertType<Route>({ screen: 'habitDetail', habitId: 'habit' });
  assertType<Route>({ screen: 'editHabit', habitId: 'habit', move: true });
});
