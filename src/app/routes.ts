import type { LocalDate } from '../domain/types';
import type { CalendarScope, PeriodWindow } from '../features/progress/calendar';
import type { PrimaryDestination } from './BottomNavigation';

type RouteParameter =
  'action' | 'move' | 'review' | 'pillarId' | 'habitId' | 'scope' | 'date' | 'window';

// Other screens' parameters are absent, including on captured return destinations.
// Optional never fields also preserve the shared route-observation dependencies in App.
type ScreenRoute<Screen extends string, Fields = Record<never, never>> = {
  screen: Screen;
} & Fields & {
    [Field in Exclude<RouteParameter, keyof Fields>]?: never;
  };

export type Route =
  | ScreenRoute<PrimaryDestination | 'archived'>
  | ScreenRoute<'habit', { pillarId: string }>
  | ScreenRoute<'pillar', { pillarId?: string }>
  | ScreenRoute<'habitDetail', { habitId: string; review?: boolean }>
  | ScreenRoute<'editHabit', { habitId: string; move?: boolean }>
  | ScreenRoute<'pillarHistory', { pillarId: string }>
  | ScreenRoute<'progressDay', { scope: CalendarScope; date: LocalDate; window: PeriodWindow }>
  | ScreenRoute<'habitAction', { habitId: string; action: 'archive' | 'reactivate' }>
  | ScreenRoute<'removePillar', { pillarId: string }>;
