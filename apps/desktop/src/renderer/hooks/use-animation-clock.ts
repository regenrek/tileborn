import { useEffect, useState } from 'react';

/**
 * A single shared animation clock for palette thumbnails. All animated
 * thumbnails read from one `requestAnimationFrame` loop (started lazily on the
 * first subscriber, stopped when the last unsubscribes) so dozens of sprite
 * thumbnails stay frame-synchronized and cheap — mirroring the single shared
 * clock the runtime renderer + Studio preview use.
 */
let rafId = 0;
let originMs = 0;
let clockMs = 0;
const subscribers = new Set<(clockMs: number) => void>();

const tick = (now: number): void => {
  if (originMs === 0) {
    originMs = now;
  }
  clockMs = now - originMs;
  for (const notify of subscribers) {
    notify(clockMs);
  }
  rafId = requestAnimationFrame(tick);
};

const subscribe = (notify: (clockMs: number) => void): (() => void) => {
  subscribers.add(notify);
  if (rafId === 0 && typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(tick);
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0 && rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      originMs = 0;
    }
  };
};

/** Subscribe to the shared animation clock; returns the current clock in ms. */
export const useAnimationClock = (enabled = true): number => {
  const [value, setValue] = useState(clockMs);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return subscribe(setValue);
  }, [enabled]);
  return enabled ? value : 0;
};
