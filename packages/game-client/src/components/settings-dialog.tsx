import type { BrandConfig } from '@tileborne/core';
import { Button } from '@tileborne/ui';
import type { ReactElement } from 'react';

import type { MenuSectionRegistration } from '../contributions/menu-registry.js';
import { SETTINGS_TABS, type SettingsTab } from '../state/menu-machine.js';
import { AudioTab, type AudioTabConfig } from './audio-tab.js';
import { ControlsTab, type ControlsTabConfig } from './controls-tab.js';
import { SlotHost } from './slot-host.js';

export interface SettingsDialogProps {
  readonly brand: BrandConfig;
  readonly sections: readonly MenuSectionRegistration[];
  readonly title?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly activeTab: SettingsTab;
  readonly onSelectTab: (tab: SettingsTab) => void;
  readonly onBack: () => void;
  readonly chrome?: boolean | undefined;
  readonly showBackAction?: boolean | undefined;
  /**
   * Wiring for the Controls remap editor (ADR-0024). When provided, the Controls
   * tab renders the live keybind editor (over the active mode's input map +
   * persistence store) instead of the static blurb. Omitted in surfaces that do
   * not run the engine input pipeline (the blurb remains).
   */
  readonly controls?: ControlsTabConfig;
  /** Runtime mixer settings wiring. Omit to keep the static Audio blurb. */
  readonly audio?: AudioTabConfig;
}

const TAB_LABELS: Record<SettingsTab, string> = {
  graphics: 'Graphics',
  audio: 'Audio',
  controls: 'Controls',
  accessibility: 'Accessibility',
};

const TAB_BLURB: Record<SettingsTab, string> = {
  graphics: 'World view preset, pixel-art toggle, FPS cap, low-spec mode.',
  audio: 'Master / music / sfx / ui volume, mute on focus loss.',
  controls: 'Key remap, gamepad deadzone, aim sensitivity.',
  accessibility: 'Colorblind mode, HUD scale, captions, reduce motion.',
};

/** Baseline settings surface with the canonical tabs + a plugin `settings.tabs` slot. */
export function SettingsDialog({
  brand,
  sections,
  title,
  subtitle,
  activeTab,
  onSelectTab,
  onBack,
  chrome = true,
  showBackAction = true,
  controls,
  audio,
}: SettingsDialogProps): ReactElement {
  const showControlsEditor = activeTab === 'controls' && controls !== undefined;
  const showAudioEditor = activeTab === 'audio' && audio !== undefined;
  const body = (
    <>
      {chrome ? (
        <>
          <h2 className="tb-title">{title ?? 'Settings'}</h2>
          {subtitle ? <p className="tb-tagline">{subtitle}</p> : null}
        </>
      ) : null}
      <div className="tb-actions-row" role="tablist" aria-label="Settings tabs">
        {SETTINGS_TABS.map((tab) => (
          <Button
            key={tab}
            role="tab"
            aria-selected={tab === activeTab}
            variant={tab === activeTab ? 'default' : 'outline'}
            size="sm"
            onClick={() => onSelectTab(tab)}
            data-testid={`settings-tab-${tab}`}
          >
            {TAB_LABELS[tab]}
          </Button>
        ))}
      </div>
      {showAudioEditor && audio !== undefined ? (
        <AudioTab {...audio} />
      ) : showControlsEditor && controls !== undefined ? (
        <ControlsTab {...controls} />
      ) : (
        <p className="tb-tagline" data-testid="settings-tab-body">
          {TAB_BLURB[activeTab]}
        </p>
      )}

      <SlotHost
        slot="settings.tabs"
        sections={sections}
        onPlay={onBack}
        onBack={onBack}
        title={brand.title}
      />

      {showBackAction ? (
        <div className="tb-actions">
          <Button variant="outline" onClick={onBack} data-testid="settings-back">
            Back
          </Button>
        </div>
      ) : null}
    </>
  );
  if (!chrome) return <>{body}</>;
  return (
    <div className="tb-scrim">
      <div className="tb-panel" role="dialog" aria-label="Settings" data-testid="settings-dialog">
        {body}
      </div>
    </div>
  );
}
