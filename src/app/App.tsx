import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { calculateProgress } from '../domain/progress';
import { Repository } from '../data/database';
import { DatasetError } from '../domain/errors';
import { deviceClock, localDate } from '../domain/calendar';
import { progressIntervalOrDefault } from '../domain/preferences';
import { agenda, summarize } from '../domain/agenda';
import {
  type Dataset,
  type OnboardingDraft,
  type GoalInput,
  type ProgressInterval,
  type AgendaItem,
} from '../domain/types';
import { emptyOnboardingDraft, normalizeOnboardingDraft } from '../domain/onboarding';
import {
  bindUpdateLifecycle,
  createUpdateController,
  type UpdateController,
  type UpdateSnapshot,
} from '../pwa/update';
import { UpdateNotice } from '../pwa/UpdateNotice';
import en from '../i18n/en.json';
import pt from '../i18n/pt.json';
import { SettingsPage } from '../features/settings/SettingsPage';
import { validGoal } from '../features/habits/formPolicy';
import { EditHabit } from '../features/habits/EditHabit';
import { HabitEditor } from '../features/habits/HabitEditor';
import { BottomNavigation, type PrimaryDestination } from './BottomNavigation';
import { TodayHeader } from '../features/today/TodayHeader';
import { TodayPage } from '../features/today/TodayPage';
import type { XpFeedbackValue } from '../features/today/XpFeedback';
import { committedCompletionXp } from '../features/today/committedCompletionXp';
import { PillarsManagement } from '../features/pillars/PillarsManagement';
import { LifecyclePrompt } from '../features/pillars/LifecyclePrompt';
import { PillarForm } from '../features/pillars/PillarForm';
import { RemovePillar } from '../features/pillars/RemovePillar';
import { pillarName as displayPillarName } from '../features/pillars/pillarName';
import { JourneyPage } from '../features/journey/JourneyPage';
import { Onboarding } from '../features/onboarding/Onboarding';
import {
  ProgressPage,
  initialProgressView,
  initialProgressViewFor,
  type ProgressView,
} from '../features/progress/ProgressPage';
import { beforeCreation, displayDefinition } from '../features/habits/habitPresentation';
import { PillarHistory } from '../features/progress/PillarHistory';
import { HabitDetail } from '../features/progress/HabitDetail';
import { ProgressDayPage } from '../features/progress/ProgressDayPage';
import type { ReturnOrigin, Route } from './routes';
import { useDepartureSession } from './useDepartureSession';
import {
  backDestination,
  backLabel,
  dedicatedReview,
  habitRoutePresentation,
  primaryDestination,
  routeHeader,
  routeHeading,
} from './routePolicy';
import './styles.css';
import { DiscardDialog } from './DiscardDialog';
import './page-heading.css';
import { usePageHeadingFocus } from './usePageHeadingFocus';

const repository = new Repository();
const emptyDraft = emptyOnboardingDraft;
type ErrorMessage = 'saveError' | 'staleError' | 'historicalConflict' | 'goalError';
type SnapshotAcceptance =
  | { kind: 'queue-result'; adoptSnapshot: boolean }
  | { kind: 'committed-display' }
  | {
      kind: 'refresh-display';
      source: 'local-reconciliation' | 'external';
      review: boolean;
    }
  | { kind: 'confirmed-replacement' };
export function App() {
  const [data, setData] = useState<Dataset>();
  const committed = useRef<Dataset | undefined>(undefined);
  const [draft, setDraft] = useState<OnboardingDraft>(emptyDraft);
  const [today, setToday] = useState(() => localDate(deviceClock.now()));
  const [route, setRoute] = useState<Route>({ screen: 'today' });
  const [progressView, setProgressView] = useState<ProgressView>(initialProgressView);
  const [pillarHistoryLimits, setPillarHistoryLimits] = useState<Record<string, number>>({});
  const [operationBusy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMessage>();
  const [status, setStatus] = useState('');
  const [xpFeedback, setXpFeedback] = useState<XpFeedbackValue>();
  const xpFeedbackId = useRef(0);
  const explicitCommits = useRef(0);
  const {
    dirty,
    reportDirty,
    departure,
    returnFocus,
    isPending,
    requestConfirmation,
    rememberEditingFocus,
    dismissConfirmation,
    finishSession,
  } = useDepartureSession();
  const [formEpoch, setFormEpoch] = useState(0);
  const epoch = useRef(0);
  const feedbackVersion = useRef(0);
  const draftVersion = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const bottomNavigation = useRef<HTMLElement>(null);
  const focusPageHeading = usePageHeadingFocus(heading);
  const replacementFocus = useRef<{ epoch: number; feedback: number } | undefined>(undefined);
  const settingsReturn = useRef<Route>({ screen: 'today' });
  const returnRoute = useRef<Route>({ screen: 'today' });
  const detailReturn = useRef<Route>({ screen: 'progress' });
  const pillarHistoryReturn = useRef<Route>({ screen: 'progress' });
  const dayOrigin = useRef<
    | {
        route: Route;
        y: number;
        id: string;
      }
    | undefined
  >(undefined);
  const pillarOrigin = useRef<
    | {
        route: Route;
        y: number;
        id: string;
      }
    | undefined
  >(undefined);
  const origin = useRef<
    | {
        route: Route;
        y: number;
        id: string;
        reveal?: boolean;
      }
    | undefined
  >(undefined);
  const restoreOrigin = useRef(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const managementOrigin = useRef<
    | {
        route: Route;
        y: number;
        id: string;
      }
    | undefined
  >(undefined);
  const directEdit = useRef(false);
  const archivedOrigin = useRef<
    | {
        route: Route;
        y: number;
        id: string;
      }
    | undefined
  >(undefined);
  const editingReview = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const retry = useRef<(() => Promise<void>) | null>(null);
  const loadStarted = useRef(false);
  const channel = useRef<BroadcastChannel | undefined>(undefined);
  const onboardingUnsaved = useRef(false);
  const settingsOperations = useRef(0);
  const [settingsOperationCount, setSettingsOperationCount] = useState(0);
  const beginSettingsOperation = useCallback(() => {
    ++settingsOperations.current;
    setSettingsOperationCount(settingsOperations.current);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      --settingsOperations.current;
      setSettingsOperationCount(settingsOperations.current);
    };
  }, []);
  const pendingWork = useRef(0);
  const operationActive = useRef(0);
  const settingsBlocked = useRef(false);
  // Only refresh-owned reads may defer entry; all queued work must still drain before activation.
  const lifecyclePending = useRef(0);
  const lifecycleActive = useRef(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [settingsUpdateBlocked, setSettingsUpdateBlocked] = useState(false);
  const blockSettingsUpdate = useCallback((blocked: boolean) => {
    settingsBlocked.current = blocked;
    setSettingsUpdateBlocked(blocked);
  }, []);
  const application = useRef<HTMLElement>(null);
  const transitionLocked = useRef(false);
  const [updateLocked, setUpdateLocked] = useState(false);
  const busy = operationBusy || updateLocked;
  const [updateState, setUpdateState] = useState<UpdateSnapshot>({
    available: false,
    applying: false,
    checking: false,
    supported: false,
    failed: false,
  });
  const updateController = useRef<UpdateController | undefined>(undefined);
  const discardForUpdate = useRef(false);
  const safety = useRef({ busy: false, dirty: false });
  safety.current = { busy: operationBusy, dirty };

  function updateSafe(entry = false) {
    return (
      document.visibilityState !== 'hidden' &&
      !isPending() &&
      !!committed.current &&
      pendingWork.current === (entry ? lifecyclePending.current : 0) &&
      operationActive.current === (entry ? lifecycleActive.current : 0) &&
      settingsOperations.current === 0 &&
      !settingsBlocked.current &&
      !onboardingUnsaved.current &&
      !safety.current.busy &&
      (!safety.current.dirty || discardForUpdate.current)
    );
  }

  function releaseUpdate() {
    transitionLocked.current = false;
    discardForUpdate.current = false;
    if (application.current) application.current.inert = false;
    setUpdateLocked(false);
  }

  useLayoutEffect(() => {
    const controller = createUpdateController({
      enabled: import.meta.env.PROD,
      baseUrl: import.meta.env.BASE_URL,
      serviceWorker: navigator.serviceWorker,
      canAccept: updateSafe,
      canEnter: () => updateSafe(true),
      changed: setUpdateState,
      reload: () => window.location.reload(),
      released: releaseUpdate,
      prepare: async () => {
        if (!updateSafe(true)) return false;
        transitionLocked.current = true;
        if (application.current) application.current.inert = true;
        setUpdateLocked(true);
        await queue.current;
        return updateSafe();
      },
    });
    updateController.current = controller;
    const unbind = bindUpdateLifecycle(controller, document, window);
    void controller.start();
    return () => {
      unbind();
      controller.dispose();
      updateController.current = undefined;
    };
    // Mount-owned controller reads the pending ref through isPending at invocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Initial loading may settle after worker discovery; only a clean genuine resume resets interaction.
  useEffect(() => {
    void updateController.current?.enter();
  }, [data, pendingCount, operationBusy, dirty, settingsOperationCount, settingsUpdateBlocked]);

  function requestUpdate() {
    if (
      transitionLocked.current ||
      isPending() ||
      safety.current.busy ||
      pendingWork.current > 0 ||
      operationActive.current > 0 ||
      settingsBlocked.current ||
      settingsOperations.current > 0 ||
      onboardingUnsaved.current
    )
      return;
    if (safety.current.dirty) {
      requestConfirmation({ update: true });
      return;
    }
    void updateController.current?.accept();
  }

  const copy = data?.settings.language === 'pt' ? pt : en;

  const invalidateRetry = () => {
    ++feedbackVersion.current;
    retry.current = null;
    setError(undefined);
    setStatus('');
    setXpFeedback(undefined);
  };

  function enqueue(
    work: () => Promise<Dataset>,
    observedEpoch = epoch.current,
    {
      lifecycleRefresh = false,
      adoptSnapshot = true,
    }: { lifecycleRefresh?: boolean; adoptSnapshot?: boolean } = {},
  ): Promise<Dataset> {
    if (transitionLocked.current)
      return Promise.reject(new Error('Application update in progress'));
    ++pendingWork.current;
    if (lifecycleRefresh) ++lifecyclePending.current;
    setPendingCount(pendingWork.current);
    const result = queue.current.then(async () => {
      if (observedEpoch !== epoch.current) throw new DatasetError('stale-revision');
      const state = await work();
      // Export may read/reconcile newer facts without adopting them into the UI.
      // Its revision must not authorize mutations from the older rendered snapshot.
      acceptSnapshot(state, { kind: 'queue-result', adoptSnapshot });
      return state;
    });
    const settled = result.finally(() => {
      --pendingWork.current;
      if (lifecycleRefresh) --lifecyclePending.current;
      setPendingCount(pendingWork.current);
    });
    queue.current = settled.catch(() => undefined);
    return settled;
  }

  function navigate(
    next: Route,
    {
      force = false,
      freshPillars = false,
      restore,
    }: { force?: boolean; freshPillars?: boolean; restore?: ReturnOrigin } = {},
  ) {
    if (transitionLocked.current || (isPending() && !force)) return;
    if (dirty && !force) {
      requestConfirmation({ route: next, freshPillars, restore });
      return;
    }
    if (next.screen === 'settings' && route.screen !== 'settings') settingsReturn.current = route;
    if (restore) {
      origin.current = restore;
      restoreOrigin.current = true;
    }
    if (freshPillars) {
      setCollapsed({});
      restoreOrigin.current = false;
      origin.current = undefined;
    }
    finishSession();
    setRoute(next);
    invalidateRetry();
  }

  async function commit(
    work: () => Promise<Dataset>,
    after?: (state: Dataset) => void,
    notify = true,
  ) {
    if (transitionLocked.current) return;
    const token = ++feedbackVersion.current;
    const observedEpoch = epoch.current;
    const focused =
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type === 'checkbox'
        ? document.activeElement
        : undefined;
    ++explicitCommits.current;
    ++operationActive.current;
    setBusy(true);
    setError(undefined);
    setStatus('');
    setXpFeedback(undefined);
    retry.current = () =>
      explicitCommits.current > 0 ? Promise.resolve() : commit(work, after, notify);
    try {
      const state = await enqueue(work, observedEpoch);
      if (observedEpoch !== epoch.current) return;
      acceptSnapshot(state, { kind: 'committed-display' });
      if (notify) channel.current?.postMessage({ revision: state.revision });
      if (token === feedbackVersion.current) {
        retry.current = null;
        after?.(state);
      }
    } catch (failure: unknown) {
      if (token === feedbackVersion.current) {
        const stale = failure instanceof DatasetError && failure.code === 'stale-revision';
        const historical =
          failure instanceof DatasetError && failure.code === 'historical-conflict';
        if (stale || historical) retry.current = null;
        setError(stale ? 'staleError' : historical ? 'historicalConflict' : 'saveError');
      }
    } finally {
      --explicitCommits.current;
      --operationActive.current;
      setBusy(false);
      requestAnimationFrame(() => {
        if (token === feedbackVersion.current && focused?.isConnected && !focused.disabled)
          focused.focus({ preventScroll: true });
      });
    }
  }

  function toggleToday(item: AgendaItem) {
    // Guard explicit actions synchronously; background reads still serialize through enqueue.
    if (explicitCommits.current > 0 || transitionLocked.current) return;
    const done = !item.done;
    let before: Dataset;
    void commit(
      () => {
        before = committed.current!;
        return repository.setDone(
          item.habit.id,
          item.date,
          done,
          deviceClock.now(),
          before.revision,
        );
      },
      (state) => {
        const language = state.settings.language;
        const copy = language === 'pt' ? pt : en;
        const xp = done
          ? committedCompletionXp(
              before,
              state,
              item.habit.id,
              item.date,
              localDate(deviceClock.now()),
            )
          : undefined;
        setStatus(
          `${done ? copy.savedDone : copy.savedUndo} ${item.goal}${xp === undefined ? '' : ` +${new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en').format(xp)} XP`}`,
        );
        if (xp !== undefined)
          setXpFeedback({
            id: ++xpFeedbackId.current,
            habitId: item.habit.id,
            date: item.date,
            xp,
          });
      },
    );
  }

  function clearPersonalState(state: Dataset) {
    ++epoch.current;
    ++draftVersion.current;
    invalidateRetry();
    setPillarHistoryLimits({});
    onboardingUnsaved.current = false;
    setDraft(normalizeOnboardingDraft(state.draft));
    editingReview.current = state.draft?.editingReview ?? false;
    finishSession();
    setFormEpoch((n) => n + 1);
  }

  function acceptSnapshot(
    state: Dataset,
    intent: Extract<SnapshotAcceptance, { kind: 'refresh-display' }>,
  ): boolean;
  function acceptSnapshot(
    state: Dataset,
    intent: Exclude<SnapshotAcceptance, { kind: 'refresh-display' }>,
  ): void;
  function acceptSnapshot(state: Dataset, intent: SnapshotAcceptance): boolean | void {
    switch (intent.kind) {
      case 'queue-result':
        if (intent.adoptSnapshot) committed.current = state;
        return;
      case 'committed-display':
        // Publication must not rewind authority already adopted by later queued work.
        setData(state);
        return;
      case 'refresh-display':
        if (state.revision === dataRevision.current && !intent.review) return false;
        // Only a revision-guarded local reconciliation preserves unrelated forms.
        if (intent.source === 'local-reconciliation') {
          setData(state);
          return false;
        }
        clearPersonalState(state);
        setData(state);
        return true;
      case 'confirmed-replacement':
        // Commit has already published and broadcast before its success callback.
        clearPersonalState(state);
        return;
    }
  }

  async function reloadCurrent({
    peer = false,
    review = false,
    lifecycleRefresh = false,
  }: { peer?: boolean; review?: boolean; lifecycleRefresh?: boolean } = {}) {
    if (transitionLocked.current) return;
    ++operationActive.current;
    if (lifecycleRefresh) ++lifecycleActive.current;
    if (review) setBusy(true);
    try {
      let locallyReconciled = false;
      const state = await enqueue(
        async () => {
          const now = deviceClock.now();
          if (!peer && !review && committed.current) {
            try {
              const current = await repository.load(now, committed.current.revision);
              locallyReconciled = true;
              return current;
            } catch (failure: unknown) {
              if (!(failure instanceof DatasetError) || failure.code !== 'stale-revision')
                throw failure;
            }
          }
          return repository.load(now);
        },
        epoch.current,
        { lifecycleRefresh },
      );
      const needsRouteRecovery = acceptSnapshot(state, {
        kind: 'refresh-display',
        source: locallyReconciled ? 'local-reconciliation' : 'external',
        review,
      });
      if (needsRouteRecovery !== true) return;

      const valid = (target: Route): Route => {
        if (target.screen === 'progressDay') {
          const { scope } = target;
          if (
            scope.kind !== 'all' &&
            !(scope.kind === 'habit' ? state.habits : state.pillars).some(
              (item) => item.id === scope.id,
            )
          )
            return { screen: 'progress' };
        }
        if (target.habitId && !state.habits.some((h) => h.id === target.habitId))
          return { screen: 'progress' };
        if (target.pillarId && !state.pillars.some((p) => p.id === target.pillarId))
          return { screen: 'pillars' };
        return target;
      };

      settingsReturn.current = valid(settingsReturn.current);
      detailReturn.current = valid(detailReturn.current);
      pillarHistoryReturn.current = valid(pillarHistoryReturn.current);
      returnRoute.current = valid(returnRoute.current);
      const interval = progressIntervalOrDefault(state.settings.progressInterval);
      setProgressView((previous) =>
        !state.onboardingComplete
          ? initialProgressViewFor(state.settings)
          : previous.interval === interval
            ? previous
            : { ...previous, interval, offset: 0 },
      );
      setRoute((previous) =>
        !state.onboardingComplete
          ? { screen: 'today' }
          : previous.screen === 'editHabit'
            ? valid({ screen: 'habitDetail', habitId: previous.habitId })
            : ['habit', 'pillar'].includes(previous.screen)
              ? { screen: 'pillars' }
              : valid(previous),
      );
      if (peer && !review) setError('staleError');
    } catch {
      if (peer || review) setError('saveError');
    } finally {
      --operationActive.current;
      if (lifecycleRefresh) --lifecycleActive.current;
      if (review) setBusy(false);
    }
  }

  const dataRevision = useRef<number | undefined>(undefined);
  // Render bookkeeping only; queued authority advances independently of publication.
  dataRevision.current = data?.revision;
  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    void commit(
      () => repository.load(deviceClock.now()),
      (state) => {
        setProgressView(initialProgressViewFor(state.settings));
        setDraft(normalizeOnboardingDraft(state.draft));
        editingReview.current = state.draft?.editingReview ?? false;
      },
      false,
    );
    // Mount-only load: changing commit identity must not repeat initialization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const notifications = new BroadcastChannel('my-goat-journey-dataset');
    channel.current = notifications;
    notifications.onmessage = () => {
      if (transitionLocked.current) return;
      ++epoch.current;
      invalidateRetry();
      void reloadCurrent({ peer: true });
    };
    return () => {
      notifications.close();
      channel.current = undefined;
    };
    // One channel per mount; preserve the existing revision/ref-based refresh lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const refresh = () => {
      const now = deviceClock.now();
      setToday(localDate(now));
      clearTimeout(timer);
      setXpFeedback(undefined);
      const boundary = new Date(now);
      boundary.setHours(24, 0, 0, 0);
      timer = setTimeout(refresh, boundary.getTime() - now.getTime());
      if (committed.current) void reloadCurrent({ lifecycleRefresh: true });
    };

    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
    // Mount-owned timer/listeners; refreshing on callback identity would enqueue extra reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!data?.onboardingComplete || !status) return;
    const timer = setTimeout(() => setStatus(''), 4000);
    return () => clearTimeout(timer);
  }, [status, data?.onboardingComplete]);
  useEffect(() => {
    document.documentElement.lang = data?.settings.language === 'pt' ? 'pt-BR' : 'en';
    document.documentElement.dataset.reducedMotion = String(data?.settings.reducedMotion ?? false);
  }, [data?.settings.language, data?.settings.reducedMotion]);
  useEffect(() => {
    const navigation = bottomNavigation.current;
    if (!navigation) return;

    const measure = () =>
      document.documentElement.style.setProperty(
        '--bottom-nav-height',
        `${navigation.getBoundingClientRect().height}px`,
      );

    const observer = new ResizeObserver(measure);
    observer.observe(navigation);
    measure();
    return () => observer.disconnect();
  }, [data?.onboardingComplete]);
  useLayoutEffect(() => {
    // Successful replacement owns focus even if an onboarding-step change also fires this effect.
    if (replacementFocus.current && route.screen === 'settings' && data?.onboardingComplete) return;
    if (restoreOrigin.current && origin.current) {
      const target =
        origin.current.id === 'general-add-habit'
          ? Array.from(document.querySelectorAll<HTMLButtonElement>('main button')).find(
              (el) => !el.closest('nav') && el.textContent === copy.addHabit,
            )
          : Array.from(document.querySelectorAll<HTMLButtonElement>('[data-history-id]')).find(
              (el) => el.dataset.historyId === origin.current!.id,
            );
      if (target) target.focus({ preventScroll: true });
      else focusPageHeading(true);
      if (origin.current.reveal && target) target.scrollIntoView({ block: 'nearest' });
      else window.scrollTo(0, origin.current.y);
      restoreOrigin.current = false;
    } else {
      focusPageHeading();
      window.scrollTo(0, 0);
    }
    // Restore focus on navigation only; a locale-only label change must not move focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    route.screen,
    route.pillarId,
    route.habitId,
    route.date,
    draft.step,
    data?.onboardingComplete,
    focusPageHeading,
  ]);
  useLayoutEffect(() => {
    const request = replacementFocus.current;
    replacementFocus.current = undefined;
    if (
      request &&
      request.epoch === epoch.current &&
      request.feedback === feedbackVersion.current &&
      route.screen === 'settings' &&
      data?.onboardingComplete &&
      !transitionLocked.current
    )
      focusPageHeading(true);
  }, [formEpoch, route.screen, data?.onboardingComplete, focusPageHeading]);
  const currentHabit = data?.habits.find((h) => h.id === route.habitId);
  const { readOnlyEditor, detailReadOnly } = habitRoutePresentation(route, currentHabit, today);
  useEffect(() => {
    if (readOnlyEditor && route.screen === 'editHabit')
      navigate({ screen: 'habitDetail', habitId: route.habitId }, { force: true });
    // Keep the existing editor guard triggers; navigate is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnlyEditor, route.habitId]);
  useEffect(() => {
    if (route.screen === 'habitAction' && currentHabit && beforeCreation(currentHabit, today)) {
      detailReturn.current = returnRoute.current;
      origin.current = managementOrigin.current;
      navigate({ screen: 'habitDetail', habitId: currentHabit.id }, { force: true });
    }
    // Keep the existing lifecycle guard triggers, not navigate's render identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.screen, currentHabit, today]);
  useEffect(() => {
    if (route.screen === 'progressDay' && route.date >= today)
      navigate({ screen: 'progress' }, { force: true });
    // Only date/route changes drive this guard; callback stabilization is separate work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, route.screen, route.date]);
  const progress = useMemo(
    () => (data ? calculateProgress(data, today) : undefined),
    [data, today],
  );

  async function selectProgressInterval(interval: ProgressInterval) {
    const focused =
      document.activeElement instanceof HTMLButtonElement &&
      document.activeElement.closest('.interval-selector')
        ? document.activeElement
        : undefined;
    const observedEpoch = epoch.current;
    const token = feedbackVersion.current + 1;
    await commit(
      () => repository.setSettings({ progressInterval: interval }, committed.current!.revision),
      () => setProgressView((previous) => ({ ...previous, interval, offset: 0 })),
    );
    requestAnimationFrame(() => {
      if (
        observedEpoch === epoch.current &&
        token === feedbackVersion.current &&
        focused?.isConnected &&
        !focused.disabled &&
        document.activeElement === document.body
      )
        focused.focus({ preventScroll: true });
    });
  }

  if (!data)
    return (
      <main ref={application}>
        <h1 ref={heading} tabIndex={-1}>
          My GOAT Journey
        </h1>
        <p>{copy.loading}</p>
        {error && (
          <div role="alert">
            {copy[error]}
            <button disabled={busy} onClick={() => retry.current?.()}>
              {copy.retry}
            </button>
          </div>
        )}
      </main>
    );
  const feedback = (
    <>
      {error && (
        <div role="alert">
          {copy[error]}
          {retry.current ? (
            <button disabled={busy} onClick={() => retry.current?.()}>
              {copy.retry}
            </button>
          ) : (
            error === 'staleError' && (
              <button disabled={busy} onClick={() => void reloadCurrent({ review: true })}>
                {copy.reload}
              </button>
            )
          )}
        </div>
      )}
      {data.onboardingComplete && (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={
            route.screen === 'today' || ['pillars', 'archived'].includes(route.screen)
              ? 'visually-hidden'
              : undefined
          }
        >
          {status}
        </p>
      )}
    </>
  );
  const updateNotice = <UpdateNotice copy={copy} state={updateState} />;

  const advance = (step: number, configured?: boolean) => {
    const next = {
      ...draft,
      step,
      editingReview: step === 5 ? false : editingReview.current,
      goals: draft.goals.map((row, index) =>
        configured !== undefined && index === draft.step - 1 ? { ...row, configured } : row,
      ),
    };
    void commit(
      () => repository.saveDraft(next, committed.current!.revision),
      () => {
        onboardingUnsaved.current = false;
        setDraft(next);
        editingReview.current = next.editingReview;
      },
    );
  };

  const update = (goal: GoalInput) => {
    if (transitionLocked.current) return;
    const next = {
      ...draft,
      goals: draft.goals.map((row) =>
        row.pillarId === goal.pillarId ? { ...goal, configured: false } : row,
      ),
    };
    onboardingUnsaved.current = true;
    setDraft(next);
    setStatus(copy.saving);
    setError(undefined);
    retry.current = null;
    const feedback = ++feedbackVersion.current;
    const version = ++draftVersion.current;
    const observedEpoch = epoch.current;
    void enqueue(() => repository.saveDraft(next, committed.current!.revision), observedEpoch)
      .then((state) => {
        if (observedEpoch !== epoch.current) return;
        if (version === draftVersion.current) onboardingUnsaved.current = false;
        acceptSnapshot(state, { kind: 'committed-display' });
        channel.current?.postMessage({ revision: state.revision });
        if (version === draftVersion.current && feedback === feedbackVersion.current) {
          setStatus(copy.draftSaved);
          retry.current = null;
        }
      })
      .catch((failure: unknown) => {
        if (version === draftVersion.current && feedback === feedbackVersion.current) {
          setStatus('');
          const stale = failure instanceof DatasetError && failure.code === 'stale-revision';
          setError(stale ? 'staleError' : 'saveError');
          retry.current = stale
            ? null
            : () =>
                commit(
                  () => repository.saveDraft(next, committed.current!.revision),
                  () => {
                    if (version === draftVersion.current) onboardingUnsaved.current = false;
                    setStatus(copy.draftSaved);
                  },
                );
        }
      });
  };

  if (!data.onboardingComplete)
    return (
      <main ref={application} inert={updateLocked} className="setup">
        {updateNotice}
        {feedback}
        <Onboarding
          key={`${formEpoch}:${draft.step}`}
          copy={copy}
          draft={draft}
          language={data.settings.language}
          busy={busy}
          status={status}
          heading={heading}
          editingReview={editingReview.current}
          advance={advance}
          update={update}
          edit={(index) => {
            editingReview.current = true;
            advance(index + 1);
          }}
          setLanguage={(language) =>
            void commit(() => repository.setSettings({ language }, committed.current!.revision))
          }
          finalize={() =>
            void commit(
              () => repository.finalize(localDate(deviceClock.now()), committed.current!.revision),
              () => {
                editingReview.current = false;
                navigate({ screen: 'today' }, { force: true });
              },
            )
          }
        />
      </main>
    );
  const items = agenda(data, today);
  const summary = summarize(items);
  const pillar = data.pillars.find((p) => p.id === route.pillarId);
  const { title, intro: pageIntro } = routeHeading(route, copy, {
    language: data.settings.language,
    pillar,
    habitAvailable: !!currentHabit,
    readOnlyEditor,
  });
  const routeReturns = () => ({
    detail: detailReturn.current,
    pillarHistory: pillarHistoryReturn.current,
    settings: settingsReturn.current,
    management: returnRoute.current,
  });
  const primary = primaryDestination(route, routeReturns());

  const openDestination = (destination: PrimaryDestination) =>
    navigate({ screen: destination }, { freshPillars: destination === 'pillars' });

  const create = (pillarId: string) => {
    returnRoute.current = route;
    const active = data.pillars.filter((p) => !p.removedOn);
    const destination = active.find((p) => p.id === pillarId) ?? active[0];
    managementOrigin.current = {
      route,
      y: scrollY,
      id: route.screen === 'pillars' ? `add:${pillarId}` : 'general-add-habit',
    };
    if (destination) navigate({ screen: 'habit', pillarId: destination.id });
    else navigate({ screen: 'pillar' });
  };

  const finishManagement = (message?: string) => {
    origin.current = managementOrigin.current;
    restoreOrigin.current = true;
    navigate(returnRoute.current, { force: true });
    if (message) setStatus(message);
  };

  const openHabit = (habitId: string, originKey = habitId) => {
    detailReturn.current = route;
    origin.current = { route, y: scrollY, id: originKey };
    navigate({
      screen: 'habitDetail',
      habitId,
      review: dedicatedReview(undefined, route, pillarHistoryReturn.current),
    });
  };

  const back = () => {
    const next = backDestination(route, routeReturns(), directEdit.current);
    const restore =
      route.screen === 'pillarHistory'
        ? pillarOrigin.current
        : route.screen === 'progressDay'
          ? dayOrigin.current
          : route.screen === 'archived'
            ? archivedOrigin.current
            : ['habit', 'habitAction', 'pillar', 'removePillar'].includes(route.screen) ||
                (route.screen === 'editHabit' && directEdit.current)
              ? managementOrigin.current
              : route.screen === 'habitDetail'
                ? origin.current
                : undefined;
    navigate(next, { restore });
  };

  const isDedicatedReview = dedicatedReview(
    route.review,
    detailReturn.current,
    pillarHistoryReturn.current,
  );
  const { primaryPage, quietBack, showBrand, className } = routeHeader(route);
  const backTarget = backDestination(route, routeReturns(), directEdit.current);
  const visibleBackLabel = backLabel(backTarget, copy);
  const habitDetail = currentHabit && (
    <HabitDetail
      readOnly={detailReadOnly}
      management={!isDedicatedReview}
      key={`${currentHabit.id}-${formEpoch}`}
      data={data}
      habit={currentHabit}
      today={today}
      progress={progress!}
      copy={copy}
      busy={busy}
      edited={invalidateRetry}
      edit={() => {
        directEdit.current = false;
        navigate({ screen: 'editHabit', habitId: currentHabit.id });
      }}
      archive={(revision, after) =>
        void commit(
          () => repository.archiveHabit(currentHabit.id, deviceClock.now(), revision),
          after,
        )
      }
      reactivate={(revision, after, destination) =>
        void commit(
          () =>
            destination
              ? repository.reactivateHabitInPillar(
                  currentHabit.id,
                  destination,
                  deviceClock.now(),
                  revision,
                )
              : repository.reactivateHabit(currentHabit.id, deviceClock.now(), revision),
          after,
        )
      }
      toggle={(item) =>
        void commit(
          () =>
            repository.setDone(
              item.habit.id,
              item.date,
              !item.done,
              deviceClock.now(),
              data.revision,
            ),
          () => setStatus(copy.recordUpdated),
        )
      }
    />
  );
  return (
    <main
      ref={application}
      inert={updateLocked}
      onFocusCapture={(event) => rememberEditingFocus(event.target)}
      className={className}
    >
      {updateNotice}
      {route.screen === 'today' ? (
        <TodayHeader
          copy={copy}
          today={today}
          language={data.settings.language}
          summary={summary}
          totalXp={progress!.totalXp}
          heading={heading}
        />
      ) : (
        <header className={primaryPage ? 'main-page-header' : undefined}>
          {quietBack && (
            <button className="quiet-back" disabled={busy} onClick={back}>
              ← {visibleBackLabel}
            </button>
          )}
          {showBrand && <p className="brand">My GOAT Journey</p>}
          <h1 className={primaryPage ? 'page-title' : undefined} ref={heading} tabIndex={-1}>
            {title}
          </h1>
          {(route.screen === 'habitDetail' || readOnlyEditor) && currentHabit && (
            <h2 className="review-goal user-content">
              {displayDefinition(currentHabit, today).goal}
            </h2>
          )}
          {pageIntro && (
            <p className={route.screen === 'journey' ? 'page-intro journey-motto' : 'page-intro'}>
              {pageIntro}
            </p>
          )}
        </header>
      )}
      {feedback}
      {!quietBack && !primaryPage && (
        <button disabled={busy} onClick={back}>
          {route.screen === 'progressDay' ? copy.backToProgress : copy.back}
        </button>
      )}
      {departure && (
        <DiscardDialog
          copy={copy}
          returnFocus={returnFocus}
          keepEditing={() => dismissConfirmation()}
          discard={() => {
            if ('update' in departure) {
              dismissConfirmation();
              discardForUpdate.current = true;
              void updateController.current?.accept().then((accepted) => {
                if (!accepted) discardForUpdate.current = false;
              });
            } else
              navigate(departure.route, {
                force: true,
                freshPillars: departure.freshPillars,
                restore: departure.restore,
              });
          }}
        />
      )}
      {route.screen === 'today' && (
        <TodayPage
          items={items}
          pillars={data.pillars}
          progress={progress!}
          language={data.settings.language}
          copy={copy}
          busy={busy}
          xpFeedback={xpFeedback}
          addHabit={() => create('mind')}
          toggle={toggleToday}
        />
      )}
      {route.screen === 'progress' && (
        <ProgressPage
          data={data}
          today={today}
          progress={progress!}
          copy={copy}
          busy={busy}
          value={progressView}
          change={setProgressView}
          selectInterval={(interval) => void selectProgressInterval(interval)}
          openHabit={openHabit}
          openDay={(scope, date, window) => {
            const id = `${scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.id}`}:${date}`;
            dayOrigin.current = { route, y: scrollY, id };
            navigate({ screen: 'progressDay', scope, date, window });
          }}
          openPillar={(pillarId) => {
            pillarHistoryReturn.current = route;
            pillarOrigin.current = { route, y: scrollY, id: pillarId };
            navigate({ screen: 'pillarHistory', pillarId });
          }}
          add={() => create('mind')}
        />
      )}
      {route.screen === 'progressDay' && route.date < today && (
        <ProgressDayPage
          data={data}
          today={today}
          scope={route.scope}
          date={route.date}
          window={route.window}
          copy={copy}
          busy={busy}
          openHabit={openHabit}
          changeDay={(date) => navigate({ ...route, date })}
          toggle={(item) =>
            void commit(
              () =>
                repository.setDone(
                  item.habit.id,
                  item.date,
                  !item.done,
                  deviceClock.now(),
                  data.revision,
                ),
              () => setStatus(copy.recordUpdated),
            )
          }
        />
      )}
      {(route.screen === 'habitDetail' || readOnlyEditor) && habitDetail}
      {route.screen === 'editHabit' && !readOnlyEditor && currentHabit && (
        <EditHabit
          key={`${currentHabit.id}-${formEpoch}`}
          data={data}
          habit={currentHabit}
          today={today}
          copy={copy}
          busy={busy}
          moveFocus={route.move}
          history={habitDetail}
          dirty={reportDirty}
          edited={invalidateRetry}
          cancel={back}
          save={(input) =>
            void commit(
              () =>
                repository.editHabit(
                  currentHabit.id,
                  input,
                  deviceClock.now(),
                  committed.current!.revision,
                ),
              (state) => {
                if (directEdit.current) {
                  const changed = state.habits.find((h) => h.id === currentHabit.id)!;
                  const destination = changed.memberships.at(-1)!.pillarId;
                  origin.current = {
                    route: detailReturn.current,
                    y: managementOrigin.current?.y ?? 0,
                    id:
                      (collapsed[destination] ?? true)
                        ? `group:${destination}`
                        : `edit:${currentHabit.id}`,
                    reveal: destination !== currentHabit.memberships.at(-1)!.pillarId,
                  };
                  restoreOrigin.current = true;
                  navigate(detailReturn.current, { force: true });
                } else
                  navigate({ screen: 'habitDetail', habitId: currentHabit.id }, { force: true });
              },
            )
          }
        />
      )}
      {route.screen === 'journey' && (
        <JourneyPage
          key={progress!.level}
          progress={progress!}
          language={data.settings.language}
          copy={copy}
        />
      )}
      {(route.screen === 'pillars' || route.screen === 'archived') && (
        <PillarsManagement
          data={data}
          today={today}
          copy={copy}
          busy={busy}
          collapsed={collapsed}
          archived={route.screen === 'archived'}
          newPillar={() => {
            returnRoute.current = route;
            managementOrigin.current = { route, y: scrollY, id: 'new-pillar' };
            navigate({ screen: 'pillar' });
          }}
          managePillar={(pillarId, action) => {
            returnRoute.current = route;
            managementOrigin.current = { route, y: scrollY, id: `pillar:${pillarId}` };
            if (action === 'streaks') {
              pillarHistoryReturn.current = route;
              pillarOrigin.current = managementOrigin.current;
              navigate({ screen: 'pillarHistory', pillarId });
            } else navigate({ screen: action === 'rename' ? 'pillar' : 'removePillar', pillarId });
          }}
          openArchived={() => {
            archivedOrigin.current = { route, y: scrollY, id: 'archived' };
            navigate({ screen: 'archived' });
          }}
          create={create}
          toggle={(id) => setCollapsed((value) => ({ ...value, [id]: !(value[id] ?? true) }))}
          edit={(habitId, move) => {
            directEdit.current = true;
            detailReturn.current = route;
            managementOrigin.current = {
              route,
              y: scrollY,
              id: `${move ? 'more' : 'edit'}:${habitId}`,
            };
            navigate({ screen: 'editHabit', habitId, move });
          }}
          review={(id, key) => openHabit(id, key)}
          lifecycle={(habitId, action, id) => {
            returnRoute.current = route;
            managementOrigin.current = { route, y: scrollY, id };
            navigate({ screen: 'habitAction', habitId, action });
          }}
        />
      )}
      {route.screen === 'habitAction' && currentHabit && !beforeCreation(currentHabit, today) && (
        <LifecyclePrompt
          key={`${currentHabit.id}-${formEpoch}`}
          data={data}
          habit={currentHabit}
          today={today}
          copy={copy}
          busy={busy}
          action={route.action}
          cancel={back}
          edited={invalidateRetry}
          confirm={(revision, destination) =>
            void commit(
              () =>
                route.action === 'archive'
                  ? repository.archiveHabit(currentHabit.id, deviceClock.now(), revision)
                  : destination
                    ? repository.reactivateHabitInPillar(
                        currentHabit.id,
                        destination,
                        deviceClock.now(),
                        revision,
                      )
                    : repository.reactivateHabit(currentHabit.id, deviceClock.now(), revision),
              () => finishManagement(),
            )
          }
        />
      )}
      {route.screen === 'pillarHistory' && pillar && (
        <PillarHistory
          data={data}
          pillar={pillar}
          today={today}
          progress={progress!}
          copy={copy}
          busy={busy}
          openHabit={openHabit}
          limit={pillarHistoryLimits[pillar.id] ?? 30}
          showMore={() =>
            setPillarHistoryLimits((previous) => ({
              ...previous,
              [pillar.id]: (previous[pillar.id] ?? 30) + 30,
            }))
          }
        />
      )}
      {route.screen === 'habit' && (
        <HabitEditor
          key={formEpoch}
          dirty={reportDirty}
          edited={invalidateRetry}
          copy={copy}
          pillars={data.pillars}
          pillarId={route.pillarId}
          busy={busy}
          cancel={back}
          save={(input) => {
            if (!validGoal(input)) {
              retry.current = null;
              setError('goalError');
              return;
            }
            void commit(
              () =>
                repository.createHabit(
                  input,
                  localDate(deviceClock.now()),
                  committed.current!.revision,
                ),
              (state) => {
                if (returnRoute.current.screen === 'pillars') {
                  const created = state.habits.at(-1)!;
                  const destination = created.memberships.at(-1)!.pillarId;
                  origin.current = {
                    route: returnRoute.current,
                    y: managementOrigin.current?.y ?? 0,
                    id:
                      (collapsed[destination] ?? true)
                        ? `group:${destination}`
                        : `edit:${created.id}`,
                    reveal: true,
                  };
                  restoreOrigin.current = true;
                }
                navigate(returnRoute.current, { force: true });
              },
            );
          }}
        />
      )}
      {route.screen === 'pillar' && (
        <PillarForm
          key={`${route.pillarId ?? 'new'}-${formEpoch}`}
          name={pillar ? displayPillarName(pillar, copy) : ''}
          rename={!!pillar}
          dirty={reportDirty}
          copy={copy}
          busy={busy}
          edited={invalidateRetry}
          cancel={back}
          save={(name) =>
            void commit(
              () =>
                pillar
                  ? repository.renamePillar(pillar.id, name, committed.current!.revision)
                  : repository.createPillar(name, committed.current!.revision),
              (state) => {
                if (!pillar && returnRoute.current.screen === 'pillars') {
                  const created = state.pillars.at(-1)!;
                  origin.current = {
                    route: returnRoute.current,
                    y: 0,
                    id: `group:${created.id}`,
                    reveal: true,
                  };
                  restoreOrigin.current = true;
                  navigate(returnRoute.current, { force: true });
                  setStatus(copy.pillarSaved);
                } else finishManagement(copy.pillarSaved);
              },
            )
          }
        />
      )}
      {route.screen === 'removePillar' && pillar && (
        <RemovePillar
          key={`${pillar.id}-${formEpoch}`}
          data={data}
          pillar={pillar}
          today={today}
          copy={copy}
          busy={busy}
          cancel={back}
          manage={() => {
            setCollapsed((value) => ({ ...value, [pillar.id]: false }));
            finishManagement();
          }}
          confirm={(revision) =>
            void commit(
              () => repository.removePillar(pillar.id, deviceClock.now(), revision),
              () => finishManagement(copy.pillarRemoved),
            )
          }
        />
      )}
      {route.screen === 'settings' && (
        <SettingsPage
          key={formEpoch}
          beginOperation={beginSettingsOperation}
          blockUpdate={blockSettingsUpdate}
          updateState={updateState}
          checkUpdate={() => void updateController.current?.check(true)}
          applyUpdate={requestUpdate}
          updateBlocked={
            operationBusy ||
            pendingCount > 0 ||
            settingsOperationCount > 0 ||
            settingsUpdateBlocked ||
            onboardingUnsaved.current
          }
          data={data}
          copy={copy}
          busy={busy}
          settings={(patch) => void commit(() => repository.setSettings(patch, data.revision))}
          fresh={() =>
            enqueue(() => repository.load(deviceClock.now()), epoch.current, {
              adoptSnapshot: false,
            })
          }
          edited={invalidateRetry}
          reset={(revision) =>
            void commit(
              () => repository.resetDataset(revision, deviceClock.now()),
              (state) => {
                acceptSnapshot(state, { kind: 'confirmed-replacement' });
                setProgressView(initialProgressViewFor(state.settings));
                navigate({ screen: 'today' }, { force: true });
                setStatus((state.settings.language === 'pt' ? pt : en).dataDeleted);
              },
            )
          }
          replace={(candidate, revision) =>
            void commit(
              () => repository.replaceDataset(candidate, revision, deviceClock.now()),
              (state) => {
                acceptSnapshot(state, { kind: 'confirmed-replacement' });
                // Consume once after the Settings remount, without scrolling or delayed callbacks.
                if (state.onboardingComplete)
                  replacementFocus.current = {
                    epoch: epoch.current,
                    feedback: feedbackVersion.current,
                  };
                settingsReturn.current = { screen: 'today' };
                detailReturn.current = { screen: 'progress' };
                pillarHistoryReturn.current = { screen: 'progress' };
                origin.current = undefined;
                pillarOrigin.current = undefined;
                setProgressView(initialProgressViewFor(state.settings));
                setStatus((state.settings.language === 'pt' ? pt : en).backupRestored);
              },
            )
          }
        />
      )}
      <BottomNavigation
        copy={copy}
        active={primary}
        busy={busy}
        navigationRef={bottomNavigation}
        open={openDestination}
      />
    </main>
  );
}
