import type { BrandConfig } from '@tileborne/core';
import { Button } from '@tileborne/ui';
import type { ReactElement } from 'react';

import type { MenuSectionRegistration } from '../contributions/menu-registry.js';
import { SlotHost } from './slot-host.js';

export interface PauseOverlayProps {
  readonly brand: BrandConfig;
  readonly sections: readonly MenuSectionRegistration[];
  readonly title?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly resumeLabel?: string | undefined;
  readonly settingsLabel?: string | undefined;
  readonly quitLabel?: string | undefined;
  readonly onResume: () => void;
  readonly onOpenSettings: () => void;
  readonly onQuitToMenu: () => void;
}

/** Esc pause overlay over the in-match HUD: Resume / Settings / Quit to menu + slot. */
export function PauseOverlay({
  brand,
  sections,
  title,
  subtitle,
  resumeLabel,
  settingsLabel,
  quitLabel,
  onResume,
  onOpenSettings,
  onQuitToMenu,
}: PauseOverlayProps): ReactElement {
  return (
    <div className="tb-scrim">
      <div className="tb-panel" role="dialog" aria-label="Paused" data-testid="pause-overlay">
        <h2 className="tb-title">{title ?? 'Paused'}</h2>
        {subtitle ? <p className="tb-tagline">{subtitle}</p> : null}
        <div className="tb-actions">
          <Button onClick={onResume} data-testid="resume-button">
            {resumeLabel ?? 'Resume'}
          </Button>
          <Button variant="outline" onClick={onOpenSettings}>
            {settingsLabel ?? 'Settings'}
          </Button>
          <SlotHost
            slot="pause.actions"
            sections={sections}
            onPlay={onResume}
            onBack={onResume}
            title={brand.title}
          />
          <Button variant="ghost" onClick={onQuitToMenu} data-testid="pause-quit">
            {quitLabel ?? 'Quit to menu'}
          </Button>
        </div>
      </div>
    </div>
  );
}
