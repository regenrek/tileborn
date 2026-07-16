/**
 * Semantic Tailwind class fragments backed by @theme tokens in styles/index.css.
 * Prefer these over arbitrary px/rem literals in components.
 *
 * Editor-chrome typography contract (canonical, use these in editor surfaces):
 *
 *   panelTitle       11px / 600 / uppercase   — "EXPLORER", "INSPECTOR", "LAYERS"
 *   panelTitleAccent 11px / 600 / uppercase / accent — "SELECTION"
 *   subsectionLabel  10px / 500 / uppercase   — "Viewport overlays", "Active tool"
 *   rowTitle         11px / 500               — list rows: layer name, list item title
 *   rowMeta          10px / 400 muted         — list row meta: "Tile", "Hidden", "60%"
 *   inlineHint       10px / 400 muted tracked — "Switch tabs ⌘1–⌘5"
 *   bodyDense        11px / 400 muted         — empty-state lines, compact descriptions
 *
 * Never combine raw `text-*` size classes with `text-muted-foreground` in
 * editor chrome — go through these. The legacy aliases (sectionLabel, etc.)
 * are kept for backward compatibility and resolve to the same classes.
 */
export const typography = {
  /** 10px — shortcuts, micro labels, kbd text */
  micro: 'text-2xs',
  /** 11px — sidebar section headers, compact body */
  caption: 'text-caption',

  panelTitle: 'text-caption font-semibold tracking-wider uppercase text-muted-foreground',
  panelTitleAccent: 'text-caption font-semibold tracking-wider uppercase text-primary',
  subsectionLabel: 'text-2xs font-medium tracking-wide uppercase text-muted-foreground',
  rowTitle: 'text-caption font-medium text-foreground',
  rowMeta: 'text-2xs text-muted-foreground',
  inlineHint: 'text-2xs tracking-wide text-muted-foreground',
  bodyDense: 'text-caption text-muted-foreground',

  // Legacy aliases — kept for backward compatibility. Prefer the named tokens
  // above for new code so the editor scale stays canonical.
  sectionLabel: 'text-caption font-semibold tracking-wide uppercase text-muted-foreground',
  sectionLabelAccent: 'text-caption font-semibold tracking-wide uppercase text-primary',
  sectionLabelMicro: 'text-2xs font-medium tracking-wide uppercase text-muted-foreground',
  bodyCompact: 'text-caption text-muted-foreground',
  bodyMicro: 'text-2xs text-muted-foreground',
  shortcut: 'text-2xs tracking-widest text-muted-foreground',
} as const;

export const focusRing = {
  sm: 'focus-ring',
  md: 'focus-ring-lg',
} as const;

export const statusSurface = {
  success: 'border-success/40 bg-success/10 text-success',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  info: 'border-info/40 bg-info/10 text-info',
} as const;

export const elevation = {
  md: 'shadow-md',
} as const;

export const motion = {
  fast: 'duration-fast transition-all ease-default',
  normal: 'duration-normal transition-all ease-default',
} as const;
