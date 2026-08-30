import { useEffect, useRef } from 'react';

export const FOCUSED_SYNC_INTERVAL_MS = 15_000;
export const BACKGROUND_SYNC_INTERVAL_MS = 5 * 60_000;

export function mailboxSessionIsActive(doc = globalThis.document) {
  if (!doc || doc.visibilityState !== 'visible') return false;
  if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return false;
  return true;
}

export function nextLiveSyncDelayMs(active) {
  return active ? FOCUSED_SYNC_INTERVAL_MS : BACKGROUND_SYNC_INTERVAL_MS;
}

export function createLiveMailboxSync({
  getActive,
  sync,
  setTimeoutFn = (fn, delay) => globalThis.setTimeout(fn, delay),
  clearTimeoutFn = (id) => globalThis.clearTimeout(id),
} = {}) {
  let timer = 0;
  let stopped = true;
  let running = false;

  const stopTimer = () => {
    if (!timer) return;
    clearTimeoutFn(timer);
    timer = 0;
  };

  const arm = () => {
    stopTimer();
    if (stopped) return;
    const delay = nextLiveSyncDelayMs(Boolean(getActive?.()));
    timer = setTimeoutFn(() => {
      timer = 0;
      void run();
    }, delay);
  };

  const run = async ({ immediate = false } = {}) => {
    if (stopped || running) return;
    running = true;
    stopTimer();
    try {
      await sync?.({ immediate });
    } finally {
      running = false;
      if (!stopped) arm();
    }
  };

  return {
    start() {
      stopped = false;
      void run({ immediate: true });
    },
    handleBecameActive() {
      if (stopped) return;
      void run({ immediate: true });
    },
    handleBecameInactive() {
      if (stopped || running) return;
      arm();
    },
    stop() {
      stopped = true;
      stopTimer();
    },
  };
}

export function useLiveMailboxSync({ enabled, onSync }) {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  useEffect(() => {
    if (!enabled) return undefined;

    const controller = createLiveMailboxSync({
      getActive: () => mailboxSessionIsActive(),
      sync: (meta) => onSyncRef.current?.(meta),
    });

    const onSessionChange = () => {
      if (mailboxSessionIsActive()) controller.handleBecameActive();
      else controller.handleBecameInactive();
    };

    document.addEventListener('visibilitychange', onSessionChange);
    window.addEventListener('focus', onSessionChange);
    window.addEventListener('pageshow', onSessionChange);
    window.addEventListener('blur', onSessionChange);
    controller.start();

    return () => {
      controller.stop();
      document.removeEventListener('visibilitychange', onSessionChange);
      window.removeEventListener('focus', onSessionChange);
      window.removeEventListener('pageshow', onSessionChange);
      window.removeEventListener('blur', onSessionChange);
    };
  }, [enabled]);
}
