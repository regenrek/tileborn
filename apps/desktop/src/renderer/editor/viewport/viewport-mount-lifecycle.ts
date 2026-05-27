/** Serializes Pixi viewport teardown so the next mount never overlaps a live adapter. */
let disposeChain: Promise<void> = Promise.resolve();

export const awaitViewportDisposeChain = (): Promise<void> => disposeChain;

export const chainViewportDispose = (dispose: () => Promise<void>): void => {
  disposeChain = disposeChain.then(dispose, dispose);
};

/** @internal Test-only reset for isolated lifecycle assertions. */
export const resetViewportDisposeChainForTests = (): void => {
  disposeChain = Promise.resolve();
};

export interface ViewportMountHandle {
  /** Marks the mount cancelled; safe to call before or after the mount resolves. */
  readonly cancel: () => void;
  /** Resolves once the mount step (including its dispose-on-cancel branch) settles. */
  readonly settled: Promise<void>;
}

export interface ViewportMountStep<TController> {
  readonly performMount: () => Promise<TController>;
  readonly disposePendingMount: () => Promise<void>;
  readonly onMounted: (controller: TController) => void;
}

/**
 * Drives a single viewport mount serialized behind the dispose chain. The mount
 * step (`performMount`) only starts after the previous dispose chain settles,
 * so a rapid unmount/remount cannot overlap two live Pixi adapters. If the
 * caller invokes `cancel()` before `performMount` resolves the resulting
 * controller is disposed instead of being published via `onMounted`.
 */
export const startSerializedViewportMount = <TController>(
  step: ViewportMountStep<TController>,
): ViewportMountHandle => {
  let cancelled = false;
  const settled = awaitViewportDisposeChain().then(async () => {
    if (cancelled) {
      await step.disposePendingMount();
      return;
    }
    const controller = await step.performMount();
    if (cancelled) {
      // Disposal was requested while we were mounting; never publish.
      await step.disposePendingMount();
      return;
    }
    step.onMounted(controller);
  });
  return {
    cancel: () => {
      cancelled = true;
    },
    settled,
  };
};
