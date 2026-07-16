import type { BrandConfig } from '@tileborne/core';
import type { ReactElement } from 'react';

export interface BootSplashProps {
  readonly brand: BrandConfig;
  /** 0..1 load progress; renders an indeterminate bar when omitted. */
  readonly progress?: number | undefined;
}

/** Fullscreen boot splash shown while the runtime boots and assets load. */
export function BootSplash({ brand, progress }: BootSplashProps): ReactElement {
  const pct = progress === undefined ? 35 : Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className="tb-boot" data-testid="boot-splash" role="status" aria-live="polite">
      {brand.logo ? (
        <img src={brand.logo.src} alt={brand.logo.alt} style={{ maxHeight: '5rem' }} />
      ) : (
        <h1 className="tb-title">{brand.title}</h1>
      )}
      <div className="tb-progress" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="tb-tagline">Loading…</p>
    </div>
  );
}
