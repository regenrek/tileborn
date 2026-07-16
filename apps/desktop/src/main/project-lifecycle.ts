import { Effect } from 'effect';

/** Canonical Electron-main boundary shared by the shipped list IPC and deterministic probe. */
export const runDesktopProjectListLifecycle = <A, E, R>(
  list: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => list();

/** Canonical Electron-main boundary shared by the shipped reopen IPC and deterministic probe. */
export const runDesktopProjectReopenLifecycle = <A, E, R>(
  open: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => open();
