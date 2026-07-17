import type { BrandConfig } from '@tileborne/core';

/**
 * Map a {@link BrandConfig} palette to CSS custom properties consumed by the
 * menu shell. Pure function — returns a plain record applied as inline style on
 * the shell root. Emits two layers:
 *
 *  - `--tb-menu-*` menu-specific tokens used by `styles/menu.css`.
 *  - shadcn-compatible `--background/--foreground/--primary/...` so reused
 *    `@tileborne/ui` components inherit the brand palette under the shell root.
 *
 * No brand/plugin names appear here; only generic palette keys.
 */
export type BrandThemeVars = Record<`--${string}`, string>;

export const brandThemeVars = (brand: BrandConfig): BrandThemeVars => {
  const p = brand.palette;
  return {
    // Menu chassis tokens
    '--tb-menu-bg': p.background,
    '--tb-menu-surface': p.surface,
    '--tb-menu-accent': p.accent,
    '--tb-menu-accent-hostile': p.accentHostile,
    '--tb-menu-accent-friendly': p.accentFriendly,
    '--tb-menu-text': p.textPrimary,
    '--tb-menu-text-muted': p.textMuted,
    // shadcn/@tileborne/ui compatible aliases (so reused UI inherits the brand)
    '--background': p.background,
    '--foreground': p.textPrimary,
    '--card': p.surface,
    '--card-foreground': p.textPrimary,
    '--popover': p.surface,
    '--popover-foreground': p.textPrimary,
    '--primary': p.accent,
    '--primary-foreground': p.background,
    '--secondary': p.surface,
    '--secondary-foreground': p.textPrimary,
    '--muted': p.surface,
    '--muted-foreground': p.textMuted,
    '--accent': p.accent,
    '--accent-foreground': p.background,
    '--destructive': p.accentHostile,
    '--border': p.textMuted,
    '--input': p.surface,
    '--ring': p.accent,
  };
};
