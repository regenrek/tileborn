import type { DesktopUpdateState } from '@tileborne/ipc-contracts';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { appVersion } from '@/lib/build-info';
import { invokeIpc } from '@/lib/ipc';

const fallbackState: DesktopUpdateState = {
  state: 'disabled',
  currentVersion: appVersion,
  diagnostic: {
    code: 'unsupported-build',
    message: 'Desktop updates are not available in this renderer.',
  },
};

let currentState: DesktopUpdateState = fallbackState;
let stateRevision = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

const setDesktopUpdateState = (state: DesktopUpdateState): void => {
  currentState = state;
  stateRevision += 1;
  emit();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const resetDesktopUpdateStoreForTests = (): void => {
  currentState = fallbackState;
  stateRevision = 0;
  listeners.clear();
};

export function useDesktopUpdates() {
  const state = useSyncExternalStore(
    subscribe,
    () => currentState,
    () => currentState,
  );

  useEffect(() => {
    const bridge = window.tileborneDesktopUpdates;
    let disposed = false;
    const initialRevision = stateRevision;
    void bridge
      .getState()
      .then((next) => {
        if (!disposed && stateRevision === initialRevision) setDesktopUpdateState(next);
      })
      .catch(() => undefined);
    const unsubscribe = bridge.onStateChanged((next) => setDesktopUpdateState(next));
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const check = useCallback(async (): Promise<DesktopUpdateState> => {
    const next = await invokeIpc(() => window.tileborneDesktopUpdates.check());
    setDesktopUpdateState(next);
    return next;
  }, []);

  const restart = useCallback(async (): Promise<DesktopUpdateState> => {
    const next = await invokeIpc(() => window.tileborneDesktopUpdates.restart());
    setDesktopUpdateState(next);
    return next;
  }, []);

  return { state, check, restart };
}
