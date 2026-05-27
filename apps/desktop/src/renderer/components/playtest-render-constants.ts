/**
 * Server tick interval used for `alpha` math when the interpolator is not
 * available (initial frames, or when projector lacks `mergeFrame`). Phase 1
 * routes most rendering through the geckos-style `SnapshotInterpolator` on
 * `SnapshotEntityStore`.
 */
export const SLICE_SERVER_TICK_MS = 1000 / 15;
