export type UpdateSnapshot = {
  available: boolean;
  applying: boolean;
  checking: boolean;
  supported: boolean;
  failed: boolean;
  checkStatus?: 'idle' | 'checking' | 'current' | 'awaiting' | 'offline' | 'failed';
};
export type UpdateOptions = {
  enabled: boolean;
  baseUrl: string;
  serviceWorker?: ServiceWorkerContainer;
  canAccept: () => boolean;
  prepare: () => Promise<boolean>;

  /** Entry may tolerate known lifecycle refresh leases; activation never does. */
  canEnter?: () => boolean;
  reload: () => void;
  changed: (snapshot: UpdateSnapshot) => void;
  released?: () => void;
  timeoutMs?: number;
  automatic?: boolean;
  online?: () => boolean;
};

/** Quiet pristine-entry transitions; explicit acceptance remains a guarded fallback. */
export function createUpdateController(options: UpdateOptions) {
  const sw = options.serviceWorker;
  const timeout = options.timeoutMs ?? 15_000;
  const initialController = sw?.controller;
  let interacted = false;
  let acknowledged = false;
  let manualChecking = false;
  let acceptanceId = 0;
  let registration: ServiceWorkerRegistration | undefined;
  let disposed = false;
  let started = false;
  let accepted: ServiceWorker | undefined;
  let reloaded = false;
  let checking: Promise<void> | undefined;
  let activationTimer: ReturnType<typeof setTimeout> | undefined;
  const failedAutomatic = new WeakSet<ServiceWorker>();
  const watched = new Map<ServiceWorker, () => void>();
  let snapshot: UpdateSnapshot = {
    available: false,
    applying: false,
    checking: false,
    supported: options.enabled && !!sw,
    failed: false,
  };

  function publish(patch: Partial<UpdateSnapshot>) {
    if (!disposed) {
      snapshot = { ...snapshot, ...patch };
      options.changed(snapshot);
    }
  }

  function bounded<T>(work: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Update timed out')), timeout);
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  // An uncontrolled document can still have an incumbent registration worker.
  // Freeze its identity (or the first installation) before any lifecycle transition.
  let entryWorker: ServiceWorker | undefined = initialController ?? undefined;

  function candidate() {
    if (!registration) return undefined;
    entryWorker ??=
      registration.active ??
      registration.waiting ??
      registration.installing ??
      sw?.controller ??
      undefined;
    // A later release can activate naturally while this old network document
    // remains uncontrolled; registration.active still identifies that update.
    const worker =
      registration.waiting ??
      (sw?.controller !== initialController ? sw?.controller : undefined) ??
      (registration.active?.state === 'activated' ? registration.active : undefined);
    return worker && worker !== entryWorker ? worker : undefined;
  }

  function discover() {
    const worker = candidate();
    publish({ available: !!worker });
  }

  // Revoke attempt authority before publication or teardown. Pending preparation
  // and acknowledgement work retain their own lifetimes and cleanup.
  function invalidateAttempt(): void {
    ++acceptanceId;
    accepted = undefined;
    acknowledged = false;
    clearTimeout(activationTimer);
  }

  function failedAcceptance(failed = false) {
    if (!snapshot.applying) return;
    invalidateAttempt();
    publish({ applying: false, failed });
    options.released?.();
    discover();
  }

  function controllerChanged() {
    // Without clients.claim(), a fresh tab stays uncontrolled even after its accepted update activates.
    if (
      !disposed &&
      acknowledged &&
      accepted &&
      (sw!.controller === accepted ||
        (!initialController && !sw!.controller && accepted.state === 'activated')) &&
      !reloaded &&
      options.canAccept()
    ) {
      reloaded = true;
      clearTimeout(activationTimer);
      options.reload();
    } else if (!snapshot.applying) discover();
  }

  function watch(worker: ServiceWorker | null | undefined) {
    if (!worker || watched.has(worker)) return;

    const changed = () => {
      if (worker === accepted && worker.state === 'redundant') failedAcceptance(true);
      if (worker === accepted && worker.state === 'activated') controllerChanged();
      discover();
      if (worker.state === 'installed') void enter();
    };

    watched.set(worker, changed);
    worker.addEventListener('statechange', changed);
  }

  function updateFound() {
    watch(registration?.installing);
    discover();
  }

  async function start() {
    if (!snapshot.supported || disposed || started) return;
    started = true;
    sw!.addEventListener('controllerchange', controllerChanged);
    try {
      const result = await bounded(
        sw!.register(options.baseUrl + 'sw.js', { scope: options.baseUrl, updateViaCache: 'none' }),
      );
      if (disposed) return;
      registration = result;
      registration.addEventListener('updatefound', updateFound);
      watch(registration.installing);
      watch(registration.waiting);
      discover();
      await enter();
      await check();
    } catch {
      publish({ supported: false });
    }
  }

  async function installed(worker: ServiceWorker | null) {
    if (!worker) return;
    let changed!: () => void;
    try {
      await bounded(
        new Promise<void>((resolve, reject) => {
          changed = () => {
            if (worker.state === 'redundant') reject(new Error('Installation failed'));
            else if (['installed', 'activating', 'activated'].includes(worker.state)) resolve();
          };
          worker.addEventListener('statechange', changed);
          changed();
        }),
      );
    } finally {
      worker.removeEventListener('statechange', changed);
    }
  }

  /** true is an explicit Settings check; background errors never replace manual feedback. */
  function check(manual = false): Promise<void> {
    if (!registration || disposed || snapshot.applying) return Promise.resolve();
    if (manual) {
      manualChecking = true;
      discover();
      publish({ checkStatus: 'checking', failed: false });
    }
    if (checking) return checking;
    if (!(options.online?.() ?? globalThis.navigator?.onLine !== false)) {
      if (manualChecking) publish({ checkStatus: 'offline', failed: false });
      manualChecking = false;
      return Promise.resolve();
    }
    publish({ checking: true });
    checking = (async () => {
      try {
        await bounded(registration!.update());
        await installed(registration!.installing);
        discover();
        if (manualChecking)
          publish({ checkStatus: candidate() ? 'awaiting' : 'current', failed: false });
      } catch {
        if (manualChecking)
          publish({
            checkStatus:
              (options.online?.() ?? globalThis.navigator?.onLine !== false) ? 'failed' : 'offline',
            failed: true,
          });
      } finally {
        checking = undefined;
        manualChecking = false;
        publish({ checking: false });
        discover();
      }
    })();
    return checking;
  }

  function enter(): Promise<boolean> {
    if (
      options.automatic === false ||
      interacted ||
      (candidate() && failedAutomatic.has(candidate()!))
    )
      return Promise.resolve(false);
    return accept(true);
  }

  async function accept(automatic = false): Promise<boolean> {
    const worker = candidate();
    const entrySafe = automatic ? (options.canEnter ?? options.canAccept) : options.canAccept;
    if (!worker || snapshot.applying || !snapshot.available || !entrySafe() || disposed)
      return false;
    const attempt = ++acceptanceId;

    const fail = (failed = false) => {
      if (attempt === acceptanceId) failedAcceptance(failed);
    };

    publish({ applying: true, failed: false, checkStatus: 'idle' });
    try {
      if (
        !(await options.prepare()) ||
        (automatic && interacted) ||
        !options.canAccept() ||
        disposed ||
        candidate() !== worker
      ) {
        fail();
        return false;
      }
      accepted = worker;
      watch(worker);
      if (sw!.controller === worker) {
        acknowledged = true;
        controllerChanged();
        return true;
      }
      activationTimer = setTimeout(() => {
        if (attempt !== acceptanceId) return;
        if (automatic) failedAutomatic.add(worker);
        fail(!automatic);
      }, timeout);
      const channel = new MessageChannel();
      try {
        const allowed = await bounded(
          new Promise<boolean>((resolve) => {
            channel.port1.onmessage = (event) => resolve(event.data?.accepted === true);
            worker.postMessage({ type: 'ACTIVATE_WHEN_ALONE' }, [channel.port2]);
          }),
        );
        if (attempt !== acceptanceId) return false;
        if (!allowed || disposed || accepted !== worker) {
          fail();
          return false;
        }
        acknowledged = true;
        controllerChanged();
        return true;
      } finally {
        channel.port1.close();
        channel.port2.close();
      }
    } catch {
      if (automatic) failedAutomatic.add(worker);
      fail(!automatic);
      return false;
    }
  }

  return {
    get snapshot() {
      return snapshot;
    },
    start,
    check,
    accept,
    enter,
    interaction() {
      interacted = true;
    },
    resume() {
      // Only a genuine clean boundary may reopen eligibility, before draining known refresh leases.
      if (!snapshot.applying && !disposed) interacted = !(options.canEnter ?? options.canAccept)();
      return enter();
    },
    dispose() {
      disposed = true;
      invalidateAttempt();
      sw?.removeEventListener('controllerchange', controllerChanged);
      registration?.removeEventListener('updatefound', updateFound);
      for (const [worker, changed] of watched) worker.removeEventListener('statechange', changed);
      watched.clear();
    },
  };
}

export type UpdateController = ReturnType<typeof createUpdateController>;

/** Ordinary focus never resets consent; a genuine clean hidden→visible resume opens a new entry. */
export function bindUpdateLifecycle(
  controller: UpdateController,
  page: EventTarget & { visibilityState: string },
  window: EventTarget,
) {
  const interaction = () => controller.interaction();

  const events = [
    'pointerdown',
    'touchstart',
    'keydown',
    'beforeinput',
    'input',
    'change',
    'click',
    'wheel',
  ];

  const resume = () => {
    if (page.visibilityState !== 'hidden') void controller.enter().then(() => controller.check());
  };

  for (const event of events)
    page.addEventListener(event, interaction, { capture: true, passive: true });
  let wasHidden = page.visibilityState === 'hidden';

  const visibility = () => {
    if (page.visibilityState === 'hidden') {
      wasHidden = true;
      return;
    }
    const resumed = wasHidden;
    wasHidden = false;
    if (resumed) void controller.resume().then(() => controller.check());
    else resume();
  };

  page.addEventListener('visibilitychange', visibility);
  for (const event of ['focus', 'pageshow', 'online']) window.addEventListener(event, resume);
  return () => {
    for (const event of events) page.removeEventListener(event, interaction, true);
    page.removeEventListener('visibilitychange', visibility);
    for (const event of ['focus', 'pageshow', 'online']) window.removeEventListener(event, resume);
  };
}
