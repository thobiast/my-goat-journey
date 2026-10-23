import type { Habit, Language, LocalDate, Pillar } from '../domain/types';
import type { Copy } from '../i18n/copy';
import { beforeCreation } from '../features/habits/habitPresentation';
import { pillarName } from '../features/pillars/pillarName';
import { fullDate } from '../features/progress/ConsistencyCard';
import type { PrimaryDestination } from './BottomNavigation';
import type { Route } from './routes';

// Values only: App retains ownership of capturing and repairing these destinations.
export interface RouteReturns {
  readonly detail: Route;
  readonly pillarHistory: Route;
  readonly settings: Route;
  readonly management: Route;
}

function unreachable(route: never): never {
  throw new Error(`Unhandled route: ${route}`);
}

export function primaryDestination(route: Route, returns: RouteReturns): PrimaryDestination {
  let context: Route;
  switch (route.screen) {
    case 'settings':
      return 'settings';
    case 'pillarHistory':
      context = returns.pillarHistory;
      break;
    case 'habitDetail':
    case 'editHabit':
      context = returns.detail;
      break;
    case 'habit':
    case 'habitAction':
    case 'pillar':
    case 'removePillar':
      context = returns.management;
      break;
    case 'today':
    case 'pillars':
    case 'journey':
    case 'progress':
    case 'progressDay':
    case 'archived':
      context = route;
      break;
    default:
      return unreachable(route);
  }
  // Preserve the single extra history-context resolution, not recursive traversal.
  if (context.screen === 'pillarHistory') context = returns.pillarHistory;
  switch (context.screen) {
    case 'today':
      return 'today';
    case 'journey':
      return 'journey';
    case 'progress':
    case 'progressDay':
      return 'progress';
    default:
      return 'pillars';
  }
}

export function backDestination(route: Route, returns: RouteReturns, directEdit: boolean): Route {
  switch (route.screen) {
    case 'archived':
      return { screen: 'pillars' };
    case 'editHabit':
      return directEdit ? returns.detail : { screen: 'habitDetail', habitId: route.habitId };
    case 'pillarHistory':
      return returns.pillarHistory;
    case 'habitDetail':
      return returns.detail;
    case 'progressDay':
      return { screen: 'progress' };
    case 'settings':
      return returns.settings;
    case 'today':
    case 'pillars':
    case 'journey':
    case 'progress':
    case 'habit':
    case 'habitAction':
    case 'pillar':
    case 'removePillar':
      return returns.management;
    default:
      return unreachable(route);
  }
}

export function backLabel(target: Route, copy: Copy): string {
  switch (target.screen) {
    case 'archived':
      return copy.archivedHabits;
    case 'pillarHistory':
      return copy.viewPillarStreaks;
    case 'habitDetail':
      return copy.reviewCompletions;
    case 'habitAction':
      return copy.manageHabit;
    case 'progressDay':
      return copy.history;
    case 'progress':
      return copy.progress;
    case 'today':
      return copy.today;
    case 'pillars':
    case 'journey':
    case 'settings':
    case 'habit':
    case 'editHabit':
    case 'pillar':
    case 'removePillar':
      return copy.pillars;
    default:
      return unreachable(target);
  }
}

export function dedicatedReview(
  explicitReview: boolean | undefined,
  detailReturn: Route,
  pillarHistoryReturn: Route,
): boolean {
  return (
    explicitReview ??
    (detailReturn.screen === 'pillars' ||
      detailReturn.screen === 'archived' ||
      (detailReturn.screen === 'pillarHistory' && pillarHistoryReturn.screen === 'pillars'))
  );
}

export function habitRoutePresentation(route: Route, habit: Habit | undefined, today: LocalDate) {
  return {
    readOnlyEditor: route.screen === 'editHabit' && !!habit && beforeCreation(habit, today),
    detailReadOnly: route.screen === 'editHabit',
  };
}

export function routeHeading(
  route: Route,
  copy: Copy,
  {
    language,
    pillar,
    habitAvailable,
    readOnlyEditor,
  }: {
    readonly language: Language;
    readonly pillar: Pillar | undefined;
    readonly habitAvailable: boolean;
    readonly readOnlyEditor: boolean;
  },
): { title: string; intro?: string } {
  switch (route.screen) {
    case 'today':
      return { title: copy.today };
    case 'pillars':
      return { title: copy.pillars, intro: copy.pillarsIntro };
    case 'journey':
      return { title: copy.journeyTitle, intro: copy.journeyMotto };
    case 'progress':
      return { title: copy.progress, intro: copy.progressIntro };
    case 'settings':
      return { title: copy.settings, intro: copy.pageHeadingSettingsIntro };
    case 'progressDay':
      return { title: fullDate(route.date, language) };
    case 'editHabit':
      return {
        title: !readOnlyEditor
          ? copy.editHabit
          : habitAvailable
            ? copy.reviewCompletions
            : pillarName(pillar, copy),
      };
    case 'habitDetail':
      // Missing identities can render briefly before App's replacement recovery.
      return { title: habitAvailable ? copy.reviewCompletions : pillarName(pillar, copy) };
    case 'archived':
      return { title: copy.archivedHabits };
    case 'habitAction':
      return { title: copy.manageHabit };
    case 'habit':
      return { title: copy.addHabit };
    case 'removePillar':
      return { title: copy.removePillarQuestion };
    case 'pillar':
      return { title: pillar ? copy.renamePillar : copy.newPillar };
    case 'pillarHistory':
      return { title: pillarName(pillar, copy) };
    default:
      return unreachable(route);
  }
}

export function routeHeader(route: Route) {
  switch (route.screen) {
    case 'today':
      // Today renders its own header; its brand branch is not displayed by App.
      return { primaryPage: true, quietBack: false, showBrand: true, className: 'today-page' };
    case 'journey':
      return { primaryPage: true, quietBack: false, showBrand: false, className: 'journey-page' };
    case 'progress':
      return { primaryPage: true, quietBack: false, showBrand: false, className: 'progress-page' };
    case 'settings':
      return { primaryPage: true, quietBack: false, showBrand: false, className: 'settings-page' };
    case 'pillars':
      return {
        primaryPage: true,
        quietBack: false,
        showBrand: false,
        className: 'pillars-management-page',
      };
    case 'progressDay':
      return {
        primaryPage: false,
        quietBack: false,
        showBrand: false,
        className: 'progress-day-page',
      };
    case 'habit':
    case 'editHabit':
    case 'habitDetail':
    case 'pillarHistory':
    case 'archived':
    case 'habitAction':
    case 'pillar':
    case 'removePillar':
      return {
        primaryPage: false,
        quietBack: true,
        showBrand: false,
        className: 'pillars-management-page',
      };
    default:
      return unreachable(route);
  }
}
