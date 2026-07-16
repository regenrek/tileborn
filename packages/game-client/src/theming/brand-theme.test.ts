import { describe, expect, it } from 'vitest';

import { defaultBrandConfig } from '../config/default-brand.js';
import { brandThemeVars } from './brand-theme.js';

describe('brandThemeVars', () => {
  it('maps the brand palette to menu + shadcn CSS variables', () => {
    const vars = brandThemeVars(defaultBrandConfig);
    expect(vars['--tb-menu-bg']).toBe('#0b1220');
    expect(vars['--tb-menu-accent']).toBe('#6ee7a8');
    // shadcn-compatible aliases so reused @tileborne/ui inherits the palette
    expect(vars['--primary']).toBe('#6ee7a8');
    expect(vars['--background']).toBe('#0b1220');
    expect(vars['--foreground']).toBe('#f8fafc');
    expect(vars['--destructive']).toBe('#f87171');
  });

  it('produces only `--`-prefixed keys', () => {
    const vars = brandThemeVars(defaultBrandConfig);
    expect(Object.keys(vars).every((key) => key.startsWith('--'))).toBe(true);
  });
});
