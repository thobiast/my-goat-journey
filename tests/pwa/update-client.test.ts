import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindUpdateLifecycle, createUpdateController } from '../../src/pwa/update';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UpdateNotice } from '../../src/pwa/UpdateNotice';
import { SettingsPage } from '../../src/features/settings/SettingsPage';
import { Repository } from '../../src/data/database';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';

class Port {
  peer!: Port;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  close = vi.fn();
  postMessage(data: unknown) {
    queueMicrotask(() => this.peer.onmessage?.({ data }));
  }
}
class Channel {
  port1 = new Port();
  port2 = new Port();
  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}
beforeEach(() => vi.stubGlobal('MessageChannel', Channel));
afterEach(() => vi.unstubAllGlobals());
class Worker extends EventTarget {
  state = 'installed';
  postMessage = vi.fn((_message: unknown, ports?: Port[]) =>
    ports?.[0].postMessage({ accepted: true }),
  );
}
class Registration extends EventTarget {
  waiting: Worker | null = new Worker();
  installing: Worker | null = null;
  active: Worker | null = new Worker();
  update = vi.fn(async () => this);
}
class Container extends EventTarget {
  controller: Worker | null = new Worker();
  registration = new Registration();
  register = vi.fn(async () => this.registration);
}

function fixture(extra = {}) {
  const sw = new Container();
  const reload = vi.fn();
  const changed = vi.fn();
  const client = createUpdateController({
    enabled: true,
    baseUrl: '/journey/',
    serviceWorker: sw as unknown as ServiceWorkerContainer,
    reload,
    changed,
    canAccept: () => true,
    prepare: async () => true,
    automatic: false,
    ...extra,
  });
  return { sw, reload, changed, client };
}

it.each([en, pt])('waiting updates never render a routine Update/Later notice', (copy) => {
  expect(
    renderToStaticMarkup(
      createElement(UpdateNotice, {
        copy,
        state: {
          available: true,
          applying: false,
          checking: false,
          supported: true,
          failed: false,
        },
      }),
    ),
  ).toBe('');
});

it.each([
  ['current', false, 'The app is up to date.'],
  [
    'awaiting',
    true,
    'An update is ready. It will apply at the next safe app opening. Close other app windows first.',
  ],
  ['offline', false, 'You are offline. Connect to check for updates.'],
  ['failed', false, 'Could not check for updates. Try again when online.'],
] as const)(
  'Settings provides truthful %s feedback with an optional guarded Update fallback',
  async (checkStatus, available, message) => {
    const data = await new Repository(`update-copy-${checkStatus}`).load(
      new Date('2026-10-09T12:00:00Z'),
    );
    const html = renderToStaticMarkup(
      createElement(SettingsPage, {
        data,
        copy: en,
        busy: false,
        settings: vi.fn(),
        fresh: async () => data,
        replace: vi.fn(),
        edited: vi.fn(),
        reset: vi.fn(),
        updateState: {
          available,
          applying: false,
          checking: false,
          supported: true,
          failed: checkStatus === 'failed',
          checkStatus,
        },
        checkUpdate: vi.fn(),
        applyUpdate: vi.fn(),
        updateBlocked: true,
      }),
    );
    expect(html).toContain(message);
    if (available) expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Update<\/button>/);
    else expect(html).not.toMatch(/>Update<\/button>/);
    expect(html).not.toMatch(/>Later<\/button>/);
  },
);

describe('quiet automatic application updates', () => {
  it('offers a naturally activated later release to an interacted uncontrolled document without forcing reload', async () => {
    const sw = new Container();
    const first = new Worker();
    const next = new Worker();
    sw.controller = null;
    first.state = 'activated';
    sw.registration.active = first;
    sw.registration.waiting = null;
    const { client, reload } = fixture({
      automatic: true,
      serviceWorker: sw as unknown as ServiceWorkerContainer,
    });
    await client.start();
    client.interaction();
    next.state = 'installing';
    sw.registration.installing = next;
    sw.registration.dispatchEvent(new Event('updatefound'));
    sw.registration.installing = null;
    sw.registration.active = next;
    next.state = 'activated';
    next.dispatchEvent(new Event('statechange'));
    expect(client.snapshot.available).toBe(true);
    expect(await client.enter()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(await client.accept()).toBe(true);
    expect(next.postMessage).toHaveBeenCalledWith(
      { type: 'ACTIVATE_WHEN_ALONE' },
      expect.any(Array),
    );
    expect(reload).toHaveBeenCalledTimes(1);
    client.dispose();
  });
  it.each(['installing', 'waiting', 'active'] as const)(
    'never accepts or reloads the first installation observed as %s',
    async (phase) => {
      const sw = new Container();
      const first = new Worker();
      const prepare = vi.fn(async () => true);
      sw.controller = null;
      sw.registration.active = null;
      sw.registration.waiting = null;
      sw.registration.installing = null;
      first.state =
        phase === 'installing' ? 'installing' : phase === 'waiting' ? 'installed' : 'activated';
      sw.registration[phase] = first;
      const { client, reload } = fixture({
        automatic: true,
        prepare,
        serviceWorker: sw as unknown as ServiceWorkerContainer,
      });
      try {
        const started = client.start();
        if (phase === 'installing') {
          await vi.waitFor(() => expect(sw.registration.update).toHaveBeenCalledTimes(1));
          sw.registration.installing = null;
          sw.registration.waiting = first;
          first.state = 'installed';
          first.dispatchEvent(new Event('statechange'));
        }
        await started;
        expect(first.postMessage).not.toHaveBeenCalled();
        expect(prepare).not.toHaveBeenCalled();
        expect(client.snapshot.available).toBe(false);
        expect(client.snapshot.applying).toBe(false);
        expect(await client.enter()).toBe(false);
        expect(await client.accept()).toBe(false);
        if (phase !== 'active') {
          sw.registration.waiting = null;
          sw.registration.active = first;
          first.state = 'activating';
          first.dispatchEvent(new Event('statechange'));
          first.state = 'activated';
          first.dispatchEvent(new Event('statechange'));
        }
        expect(sw.controller).toBeNull();
        expect(reload).not.toHaveBeenCalled();
        // Even a later first-controller notification is not evidence of a new release.
        sw.controller = first;
        sw.dispatchEvent(new Event('controllerchange'));
        expect(client.snapshot.available).toBe(false);
        expect(await client.enter()).toBe(false);
        expect(reload).not.toHaveBeenCalled();
        expect(first.postMessage).not.toHaveBeenCalled();
      } finally {
        client.dispose();
      }
    },
  );
  it.each([false, true])(
    'a later release remains an update after the initial worker naturally activates without claiming the tab (B claims=%s)',
    async (claims) => {
      const sw = new Container();
      const first = new Worker();
      sw.controller = null;
      first.state = 'installing';
      sw.registration.active = null;
      sw.registration.waiting = null;
      sw.registration.installing = first;
      const { client, reload } = fixture({
        automatic: true,
        serviceWorker: sw as unknown as ServiceWorkerContainer,
      });
      try {
        const started = client.start();
        await vi.waitFor(() => expect(sw.registration.update).toHaveBeenCalledTimes(1));
        sw.registration.installing = null;
        sw.registration.waiting = first;
        first.state = 'installed';
        first.dispatchEvent(new Event('statechange'));
        await started;
        sw.registration.waiting = null;
        sw.registration.active = first;
        first.state = 'activated';
        first.dispatchEvent(new Event('statechange'));
        expect(sw.controller).toBeNull();
        expect(first.postMessage).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        client.interaction();
        const next = new Worker();
        next.state = 'installing';
        sw.registration.installing = next;
        sw.registration.dispatchEvent(new Event('updatefound'));
        sw.registration.installing = null;
        sw.registration.waiting = next;
        next.state = 'installed';
        next.dispatchEvent(new Event('statechange'));
        expect(client.snapshot.available).toBe(true);
        expect(await client.enter()).toBe(false);
        expect(next.postMessage).not.toHaveBeenCalled();
        expect(await client.accept()).toBe(true);
        expect(next.postMessage).toHaveBeenCalledExactlyOnceWith(
          { type: 'ACTIVATE_WHEN_ALONE' },
          expect.any(Array),
        );
        expect(reload).not.toHaveBeenCalled();
        sw.registration.waiting = null;
        sw.registration.active = next;
        next.state = 'activating';
        next.dispatchEvent(new Event('statechange'));
        expect(reload).not.toHaveBeenCalled();
        if (claims) {
          sw.controller = next;
          sw.dispatchEvent(new Event('controllerchange'));
        }
        next.state = 'activated';
        next.dispatchEvent(new Event('statechange'));
        expect(reload).toHaveBeenCalledTimes(1);
        sw.controller = next;
        sw.dispatchEvent(new Event('controllerchange'));
        next.dispatchEvent(new Event('statechange'));
        expect(reload).toHaveBeenCalledTimes(1);
      } finally {
        client.dispose();
      }
    },
  );
  it('retries blocked pristine entry but never automatically transitions after the first interaction, even after focus or a new install', async () => {
    let safe = false;
    const { sw, client, reload } = fixture({ automatic: true, canAccept: () => safe });
    await client.start();
    expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
    expect(client).toHaveProperty('enter');
    safe = true;
    await client.enter();
    expect(sw.registration.waiting!.postMessage).toHaveBeenCalledTimes(1);
    client.dispose();
    const active = fixture({ automatic: true, canAccept: () => safe });
    safe = false;
    await active.client.start();
    active.client.interaction();
    safe = true;
    await active.client.enter();
    const next = new Worker();
    active.sw.registration.installing = next;
    active.sw.registration.dispatchEvent(new Event('updatefound'));
    active.sw.registration.waiting = next;
    next.dispatchEvent(new Event('statechange'));
    await active.client.enter();
    expect(next.postMessage).not.toHaveBeenCalled();
    expect(active.reload).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    active.client.dispose();
  });
  it('activates a waiting release at pristine safe entry using the sole-client acknowledgement protocol', async () => {
    const { sw, client, reload } = fixture({ automatic: true });
    await client.start();
    expect(sw.registration.waiting!.postMessage).toHaveBeenCalledWith(
      { type: 'ACTIVATE_WHEN_ALONE' },
      expect.any(Array),
    );
    expect(client.snapshot.applying).toBe(true);
    const waiting = sw.registration.waiting!;
    sw.controller = waiting;
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
    client.dispose();
  });
});

describe('user-accepted application updates', () => {
  it('registers within the deployment base and discovers an existing waiting worker without activating', async () => {
    const { sw, client, reload } = fixture();
    await client.start();
    expect(sw.register).toHaveBeenCalledWith('/journey/sw.js', {
      scope: '/journey/',
      updateViaCache: 'none',
    });
    expect(client.snapshot.available).toBe(true);
    expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    client.dispose();
  });
});

it.each([true, false])(
  'only a real hidden-to-visible clean resume can reopen automatic eligibility after interaction (safe=%s)',
  async (resumeSafe) => {
    let safe = false;
    const { sw, client, reload } = fixture({ automatic: true, canAccept: () => safe });
    await client.start();
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const window = new EventTarget();
    const unbind = bindUpdateLifecycle(client, page, window);
    page.dispatchEvent(new Event('pointerdown'));
    safe = true;
    for (const event of ['focus', 'pageshow']) window.dispatchEvent(new Event(event));
    page.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
    expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    safe = resumeSafe;
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() =>
      expect(sw.registration.waiting!.postMessage).toHaveBeenCalledTimes(resumeSafe ? 1 : 0),
    );
    if (!resumeSafe) {
      safe = true;
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
      expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
    }
    expect(reload).not.toHaveBeenCalled();
    unbind();
    client.dispose();
  },
);

it('a genuine clean resume drains only known lifecycle refresh work before activating', async () => {
  let entrySafe = false;
  let refreshPending = false;
  let finishRefresh!: () => void;
  const drained = new Promise<void>((resolve) => {
    finishRefresh = resolve;
  });
  const prepare = vi.fn(async () => {
    await drained;
    return true;
  });
  const { sw, client, reload } = fixture({
    automatic: true,
    canAccept: () => entrySafe && !refreshPending,
    canEnter: () => entrySafe,
    prepare,
  });
  try {
    await client.start();
    client.interaction();
    entrySafe = true;
    refreshPending = true;
    expect(await client.accept()).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
    const resumed = client.resume();
    expect(client.snapshot.applying).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await client.accept()).toBe(false);
    expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
    refreshPending = false;
    finishRefresh();
    expect(await resumed).toBe(true);
    expect(sw.registration.waiting!.postMessage).toHaveBeenCalledTimes(1);
    sw.controller = sw.registration.waiting;
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    client.dispose();
  }
});

it.each(['input', 'unfinished queue'])(
  'a clean resume still cancels for %s after refresh preparation',
  async (blocker) => {
    let entrySafe = false;
    let activationSafe = false;
    let finish!: () => void;
    const prepare = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = () => resolve(true);
        }),
    );
    const { sw, client, reload } = fixture({
      automatic: true,
      canEnter: () => entrySafe,
      canAccept: () => activationSafe,
      prepare,
    });
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const window = new EventTarget();
    const unbind = bindUpdateLifecycle(client, page, window);
    try {
      await client.start();
      page.dispatchEvent(new Event('pointerdown'));
      entrySafe = true;
      const resumed = client.resume();
      expect(client.snapshot.applying).toBe(true);
      expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
      if (blocker === 'input') {
        page.dispatchEvent(new Event('beforeinput'));
        activationSafe = true;
        // Another lifecycle event during the same drain cannot undo new input.
        expect(await client.resume()).toBe(false);
      }
      finish();
      expect(await resumed).toBe(false);
      expect(client.snapshot.applying).toBe(false);
      expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      if (blocker === 'input') expect(await client.enter()).toBe(false);
    } finally {
      unbind();
      client.dispose();
    }
  },
);

it('an unsafe resume closes even pristine eligibility until another genuine clean resume', async () => {
  let safe = false;
  const prepare = vi.fn(async () => true);
  const { sw, client } = fixture({
    automatic: true,
    canAccept: () => safe,
    canEnter: () => safe,
    prepare,
  });
  try {
    await client.start();
    expect(await client.resume()).toBe(false);
    safe = true;
    expect(await client.enter()).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
    expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
    expect(await client.resume()).toBe(true);
    expect(sw.registration.waiting!.postMessage).toHaveBeenCalledTimes(1);
  } finally {
    client.dispose();
  }
});

it('lifecycle binding checks visible focus/online and permanently closes automatic entry on any interaction, with complete disposal', async () => {
  expect(bindUpdateLifecycle).toBeTypeOf('function');
  let safe = false;
  const { sw, client, reload } = fixture({ automatic: true, canAccept: () => safe });
  await client.start();
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  const unbind = bindUpdateLifecycle(client, page, window);
  page.visibilityState = 'hidden';
  window.dispatchEvent(new Event('focus'));
  await Promise.resolve();
  expect(sw.registration.update).toHaveBeenCalledTimes(1);
  page.visibilityState = 'visible';
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => expect(sw.registration.update).toHaveBeenCalledTimes(2));
  page.dispatchEvent(new Event('keydown'));
  safe = true;
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(sw.registration.update).toHaveBeenCalledTimes(3));
  expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  unbind();
  window.dispatchEvent(new Event('focus'));
  await Promise.resolve();
  expect(sw.registration.update).toHaveBeenCalledTimes(3);
  client.dispose();
});

it('quiet discovery checks at startup and installs automatically only while the document remains pristine', async () => {
  const sw = new Container();
  sw.registration.waiting = null;
  const { client } = fixture({
    automatic: true,
    serviceWorker: sw as unknown as ServiceWorkerContainer,
  });
  await client.start();
  expect(sw.registration.update).toHaveBeenCalledTimes(1);
  const next = new Worker();
  next.state = 'installing';
  sw.registration.installing = next;
  sw.registration.dispatchEvent(new Event('updatefound'));
  sw.registration.waiting = next;
  next.state = 'installed';
  next.dispatchEvent(new Event('statechange'));
  await vi.waitFor(() => expect(next.postMessage).toHaveBeenCalledTimes(1));
  client.dispose();
});
it('a timed-out automatic transition stays unlocked without retrying or reloading that worker on later focus or activation', async () => {
  vi.useFakeTimers();
  const { sw, client, reload } = fixture({ automatic: true, timeoutMs: 50 });
  try {
    await client.start();
    const worker = sw.registration.waiting!;
    await vi.advanceTimersByTimeAsync(51);
    expect(client.snapshot.applying).toBe(false);
    await client.enter();
    await client.enter();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    sw.controller = worker;
    sw.dispatchEvent(new Event('controllerchange'));
    await client.enter();
    expect(reload).not.toHaveBeenCalled();
  } finally {
    client.dispose();
    vi.useRealTimers();
  }
});

it.each([false, true])(
  "reload permission requires the exact worker's positive acknowledgement even when activation races its reply (%s)",
  async (allowed) => {
    const { sw, client, reload } = fixture();
    await client.start();
    const worker = sw.registration.waiting!;
    worker.postMessage.mockImplementation((_message, ports) => {
      sw.registration.waiting = null;
      sw.controller = worker;
      sw.dispatchEvent(new Event('controllerchange'));
      expect(reload).not.toHaveBeenCalled();
      ports![0].postMessage({ accepted: allowed });
    });
    expect(await client.accept()).toBe(allowed);
    expect(reload).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (!allowed) expect(client.snapshot.applying).toBe(false);
    client.dispose();
  },
);

it('accepts once only after preparation and reloads only for that worker, never a peer activation', async () => {
  let release!: (value: boolean) => void;
  const prepare = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  const { sw, client, reload } = fixture({ prepare });
  await client.start();
  const waiting = sw.registration.waiting!;
  const acceptance = client.accept();
  expect(client.snapshot.applying).toBe(true);
  expect(waiting.postMessage).not.toHaveBeenCalled();
  expect(await client.accept()).toBe(false);
  release(true);
  expect(await acceptance).toBe(true);
  expect(waiting.postMessage).toHaveBeenCalledExactlyOnceWith(
    { type: 'ACTIVATE_WHEN_ALONE' },
    expect.any(Array),
  );
  sw.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  sw.controller = waiting;
  sw.dispatchEvent(new Event('controllerchange'));
  sw.dispatchEvent(new Event('controllerchange'));
  expect(reload).toHaveBeenCalledTimes(1);
  client.dispose();
});
it('reloads an initially uncontrolled accepting tab exactly once when its accepted worker activates without claiming it', async () => {
  vi.useFakeTimers();
  const sw = new Container();
  sw.controller = null;
  const released = vi.fn();
  const { client, reload } = fixture({
    serviceWorker: sw as unknown as ServiceWorkerContainer,
    timeoutMs: 50,
    released,
  });
  try {
    await client.start();
    const waiting = sw.registration.waiting!;
    expect(client.snapshot.available).toBe(true);
    expect(await client.accept()).toBe(true);
    expect(waiting.postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: 'ACTIVATE_WHEN_ALONE' },
      expect.any(Array),
    );
    sw.registration.waiting = null;
    sw.registration.active = waiting;
    waiting.state = 'activating';
    waiting.dispatchEvent(new Event('statechange'));
    expect(reload).not.toHaveBeenCalled();
    waiting.state = 'activated';
    waiting.dispatchEvent(new Event('statechange'));
    expect(sw.controller).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    waiting.dispatchEvent(new Event('statechange'));
    sw.dispatchEvent(new Event('controllerchange'));
    await vi.advanceTimersByTimeAsync(51);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(released).not.toHaveBeenCalled();
    expect(client.snapshot.failed).toBe(false);
  } finally {
    client.dispose();
    vi.useRealTimers();
  }
});
it.each(['unaccepted', 'unsafe', 'timed out', 'disposed', 'other worker', 'previously controlled'])(
  'does not reload on activated state when %s',
  async (reason) => {
    vi.useFakeTimers();
    const sw = new Container();
    if (reason !== 'previously controlled') sw.controller = null;
    let safe = true;
    const { client, reload } = fixture({
      serviceWorker: sw as unknown as ServiceWorkerContainer,
      canAccept: () => safe,
      timeoutMs: 50,
    });
    try {
      await client.start();
      const waiting = sw.registration.waiting!;
      if (reason !== 'unaccepted') expect(await client.accept()).toBe(true);
      if (reason === 'unsafe') safe = false;
      if (reason === 'timed out') await vi.advanceTimersByTimeAsync(51);
      if (reason === 'disposed') client.dispose();
      if (reason === 'previously controlled') sw.controller = null;
      let activated = waiting;
      if (reason === 'other worker') {
        activated = new Worker();
        sw.registration.installing = activated;
        sw.registration.dispatchEvent(new Event('updatefound'));
      }
      sw.registration.waiting = null;
      sw.registration.active = activated;
      activated.state = 'activated';
      activated.dispatchEvent(new Event('statechange'));
      sw.dispatchEvent(new Event('controllerchange'));
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(51);
      activated.dispatchEvent(new Event('statechange'));
      expect(reload).not.toHaveBeenCalled();
    } finally {
      client.dispose();
      vi.useRealTimers();
    }
  },
);
it('rejects busy acceptance and rechecks safety after async preparation without activating', async () => {
  let safe = false;
  const prepare = vi.fn(async () => {
    safe = false;
    return true;
  });
  const { sw, client } = fixture({ canAccept: () => safe, prepare });
  await client.start();
  expect(await client.accept()).toBe(false);
  expect(prepare).not.toHaveBeenCalled();
  safe = true;
  expect(await client.accept()).toBe(false);
  expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
  expect(client.snapshot.applying).toBe(false);
  client.dispose();
});

it('a replacement installation remains discoverable without legacy notice dismissal', async () => {
  const { sw, client } = fixture();
  await client.start();
  expect(client.snapshot.available).toBe(true);
  await client.check();
  expect(client.snapshot.available).toBe(true);
  const next = new Worker();
  next.state = 'installing';
  sw.registration.installing = next;
  sw.registration.dispatchEvent(new Event('updatefound'));
  sw.registration.waiting = next;
  next.state = 'installed';
  next.dispatchEvent(new Event('statechange'));
  expect(client.snapshot.available).toBe(true);
  expect(next.postMessage).not.toHaveBeenCalled();
  client.dispose();
});
it('background failures stay quiet, explicit checks report offline/failure/current, and a coalesced manual check owns its feedback', async () => {
  let online = true;
  const { sw, client } = fixture({ online: () => online });
  await client.start();
  sw.registration.update.mockRejectedValue(new Error('network'));
  await client.check();
  expect(client.snapshot.failed).toBe(false);
  await client.check(true);
  expect(client.snapshot.checkStatus).toBe('failed');
  online = false;
  await client.check(true);
  expect(client.snapshot.checkStatus).toBe('offline');
  online = true;
  sw.registration.waiting = null;
  let finish!: () => void;
  sw.registration.update.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(sw.registration);
      }),
  );
  const background = client.check();
  const manual = client.check(true);
  expect(client.snapshot.checkStatus).toBe('checking');
  finish();
  await Promise.all([background, manual]);
  expect(client.snapshot.checkStatus).toBe('current');
  expect(client.snapshot.failed).toBe(false);
  client.dispose();
});
it.each(['installed', 'redundant'])(
  'manual checks wait for pending installation before reporting %s',
  async (state) => {
    const { sw, client } = fixture();
    await client.start();
    sw.registration.waiting = null;
    const worker = new Worker();
    worker.state = 'installing';
    sw.registration.update.mockImplementation(async () => {
      sw.registration.installing = worker;
      sw.registration.dispatchEvent(new Event('updatefound'));
      return sw.registration;
    });
    const checked = client.check(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(client.snapshot.checking).toBe(true);
    worker.state = state;
    sw.registration.installing = null;
    if (state === 'installed') sw.registration.waiting = worker;
    worker.dispatchEvent(new Event('statechange'));
    await checked;
    expect(client.snapshot.checkStatus).toBe(state === 'installed' ? 'awaiting' : 'failed');
    client.dispose();
  },
);

it('coalesces resume checks and bounds network failures without losing an existing update', async () => {
  vi.useFakeTimers();
  try {
    const { sw, client } = fixture({ timeoutMs: 50 });
    await client.start();
    sw.registration.update.mockClear();
    sw.registration.update.mockImplementation(() => new Promise(() => {}));
    const first = client.check();
    const second = client.check();
    expect(sw.registration.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(51);
    await Promise.all([first, second]);
    expect(client.snapshot.checking).toBe(false);
    expect(client.snapshot.available).toBe(true);
    sw.registration.update.mockRejectedValue(new Error('offline'));
    await client.check(true);
    expect(client.snapshot.failed).toBe(true);
    expect(client.snapshot.available).toBe(true);
    client.dispose();
  } finally {
    vi.useRealTimers();
  }
});
it('registration failure, insecure unavailability and development never break the app', async () => {
  const dev = fixture({ enabled: false });
  await dev.client.start();
  expect(dev.sw.register).not.toHaveBeenCalled();
  dev.client.dispose();
  const missing = fixture({ serviceWorker: undefined });
  await missing.client.start();
  expect(missing.client.snapshot.supported).toBe(false);
  missing.client.dispose();
  const denied = fixture();
  denied.sw.register.mockRejectedValue(new Error('SecurityError'));
  await denied.client.start();
  expect(denied.client.snapshot.supported).toBe(false);
  denied.client.dispose();
});
it('manual activation failure is not misreported as the preceding failed update check', async () => {
  const { sw, client } = fixture();
  await client.start();
  sw.registration.update.mockRejectedValue(new Error('network'));
  await client.check(true);
  expect(client.snapshot.checkStatus).toBe('failed');
  sw.registration.waiting!.postMessage.mockImplementation(() => {
    throw new Error('activation');
  });
  expect(await client.accept()).toBe(false);
  expect(client.snapshot.failed).toBe(true);
  expect(client.snapshot.checkStatus).toBe('idle');
  client.dispose();
});

it("a superseded worker's delayed acknowledgement cannot release or authorize a newer acceptance", async () => {
  const { sw, client, reload } = fixture();
  await client.start();
  const firstWorker = sw.registration.waiting!;
  let firstReply!: Port;
  let nextReply!: Port;
  firstWorker.postMessage.mockImplementation((_message, ports) => {
    firstReply = ports![0];
  });
  const first = client.accept();
  await Promise.resolve();
  firstWorker.state = 'redundant';
  firstWorker.dispatchEvent(new Event('statechange'));
  const next = new Worker();
  next.postMessage.mockImplementation((_message, ports) => {
    nextReply = ports![0];
  });
  sw.registration.waiting = next;
  sw.registration.installing = next;
  sw.registration.dispatchEvent(new Event('updatefound'));
  const second = client.accept();
  await Promise.resolve();
  firstReply.postMessage({ accepted: true });
  expect(await first).toBe(false);
  expect(client.snapshot.applying).toBe(true);
  sw.controller = next;
  sw.registration.waiting = null;
  sw.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  nextReply.postMessage({ accepted: true });
  expect(await second).toBe(true);
  expect(reload).toHaveBeenCalledTimes(1);
  client.dispose();
});

it('a silent acknowledgement timeout releases the lock once and ignores a late positive reply', async () => {
  vi.useFakeTimers();
  const released = vi.fn();
  const { sw, client, reload } = fixture({ timeoutMs: 50, released });
  try {
    await client.start();
    const worker = sw.registration.waiting!;
    let reply!: Port;
    worker.postMessage.mockImplementation((_message, ports) => {
      reply = ports![0];
    });
    const accepted = client.accept();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(51);
    expect(await accepted).toBe(false);
    expect(released).toHaveBeenCalledTimes(1);
    reply.postMessage({ accepted: true });
    sw.controller = worker;
    sw.dispatchEvent(new Event('controllerchange'));
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    expect(client.snapshot.applying).toBe(false);
  } finally {
    client.dispose();
    vi.useRealTimers();
  }
});

it('bounds a stalled activation, unlocks on failure, and never reloads for its later controller event', async () => {
  vi.useFakeTimers();
  try {
    const released = vi.fn();
    const { sw, client, reload } = fixture({ timeoutMs: 50, released });
    await client.start();
    const waiting = sw.registration.waiting!;
    await client.accept();
    await vi.advanceTimersByTimeAsync(51);
    expect(client.snapshot.applying).toBe(false);
    expect(released).toHaveBeenCalledTimes(1);
    sw.controller = waiting;
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    client.dispose();
  } finally {
    vi.useRealTimers();
  }
});
it('disposal cancels pending preparation without activation and removes listeners', async () => {
  let release!: (value: boolean) => void;
  const released = vi.fn();
  const { sw, client, reload } = fixture({
    released,
    prepare: () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  });
  await client.start();
  const accepted = client.accept();
  client.dispose();
  release(true);
  expect(await accepted).toBe(false);
  expect(sw.registration.waiting!.postMessage).not.toHaveBeenCalled();
  sw.controller = sw.registration.waiting;
  sw.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
});

it('a newly controlled initially uncontrolled document can locally accept its already activated controller without activating peers', async () => {
  const sw = new Container();
  sw.controller = null;
  const { client, reload } = fixture({ serviceWorker: sw as unknown as ServiceWorkerContainer });
  await client.start();
  const next = sw.registration.waiting!;
  sw.registration.waiting = null;
  next.state = 'activated';
  sw.controller = next;
  sw.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  expect(client.snapshot.available).toBe(true);
  expect(await client.accept()).toBe(true);
  expect(next.postMessage).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalledTimes(1);
  client.dispose();
});

it('a peer activation never reloads, but this tab can explicitly accept the already-active update', async () => {
  const { sw, client, reload } = fixture();
  await client.start();
  const next = sw.registration.waiting!;
  sw.registration.waiting = null;
  sw.controller = next;
  sw.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  expect(client.snapshot.available).toBe(true);
  expect(await client.accept()).toBe(true);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(next.postMessage).not.toHaveBeenCalled();
  client.dispose();
});
