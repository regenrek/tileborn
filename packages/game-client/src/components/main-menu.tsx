import type { BrandConfig } from '@tileborne/core';
import { Button } from '@tileborne/ui';
import type { ReactElement } from 'react';

import type { MenuSectionRegistration } from '../contributions/menu-registry.js';
import { SlotHost } from './slot-host.js';

export interface MainMenuProps {
  readonly brand: BrandConfig;
  readonly sections: readonly MenuSectionRegistration[];
  readonly title?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly playLabel?: string | undefined;
  readonly settingsLabel?: string | undefined;
  readonly onPlay: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenCredits: () => void;
  readonly onQuit?: (() => void) | undefined;
}

/** Baseline brand-neutral main menu: title/logo, Play CTA, Settings, Credits, Quit + slots. */
export function MainMenu({
  brand,
  sections,
  title,
  subtitle,
  playLabel,
  settingsLabel,
  onPlay,
  onOpenSettings,
  onOpenCredits,
  onQuit,
}: MainMenuProps): ReactElement {
  // On the main screen there is no "back"; sections that need it use onPlay.
  const slotProps = { onPlay, onBack: () => undefined, title: brand.title };
  return (
    <div className="tb-scrim">
      <div className="tb-panel" aria-label="Main menu" data-testid="main-menu">
        {brand.logo ? (
          <img src={brand.logo.src} alt={brand.logo.alt} style={{ maxHeight: '4rem' }} />
        ) : (
          <h1 className="tb-title">{title ?? brand.title}</h1>
        )}
        {(subtitle ?? brand.lobbyCopy.tagline) ? (
          <p className="tb-tagline">{subtitle ?? brand.lobbyCopy.tagline}</p>
        ) : null}

        <div className="tb-actions">
          <Button size="lg" onClick={onPlay} data-testid="play-button">
            {playLabel ?? (brand.lobbyCopy.cta || 'Play')}
          </Button>
          <SlotHost slot="main.primaryActions" sections={sections} {...slotProps} />
        </div>

        <SlotHost slot="main.tabs" sections={sections} {...slotProps} />

        <div className="tb-section-label">More</div>
        <div className="tb-actions">
          <Button variant="outline" onClick={onOpenSettings} data-testid="settings-button">
            {settingsLabel ?? 'Settings'}
          </Button>
          <Button variant="outline" onClick={onOpenCredits}>
            Credits / About
          </Button>
          <SlotHost slot="main.secondaryActions" sections={sections} {...slotProps} />
          {onQuit ? (
            <Button variant="ghost" onClick={onQuit} data-testid="quit-button">
              Quit
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
