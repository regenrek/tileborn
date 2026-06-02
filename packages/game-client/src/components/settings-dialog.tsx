import type { BrandConfig } from "@tileborne/core";
import { Button } from "@tileborne/ui";
import type { ReactElement } from "react";

import type { MenuSectionRegistration } from "../contributions/menu-registry.js";
import { SETTINGS_TABS, type SettingsTab } from "../state/menu-machine.js";
import { SlotHost } from "./slot-host.js";

export interface SettingsDialogProps {
  readonly brand: BrandConfig;
  readonly sections: readonly MenuSectionRegistration[];
  readonly activeTab: SettingsTab;
  readonly onSelectTab: (tab: SettingsTab) => void;
  readonly onBack: () => void;
}

const TAB_LABELS: Record<SettingsTab, string> = {
  graphics: "Graphics",
  audio: "Audio",
  controls: "Controls",
  accessibility: "Accessibility",
};

const TAB_BLURB: Record<SettingsTab, string> = {
  graphics: "World view preset, pixel-art toggle, FPS cap, low-spec mode.",
  audio: "Master / music / sfx / ui volume, mute on focus loss.",
  controls: "Key remap, gamepad deadzone, aim sensitivity.",
  accessibility: "Colorblind mode, HUD scale, captions, reduce motion.",
};

/** Baseline settings surface with the canonical tabs + a plugin `settings.tabs` slot. */
export function SettingsDialog({
  brand,
  sections,
  activeTab,
  onSelectTab,
  onBack,
}: SettingsDialogProps): ReactElement {
  return (
    <div className="tb-scrim">
      <div className="tb-panel" role="dialog" aria-label="Settings" data-testid="settings-dialog">
        <h2 className="tb-title">Settings</h2>
        <div className="tb-actions-row" role="tablist" aria-label="Settings tabs">
          {SETTINGS_TABS.map((tab) => (
            <Button
              key={tab}
              role="tab"
              aria-selected={tab === activeTab}
              variant={tab === activeTab ? "default" : "outline"}
              size="sm"
              onClick={() => onSelectTab(tab)}
              data-testid={`settings-tab-${tab}`}
            >
              {TAB_LABELS[tab]}
            </Button>
          ))}
        </div>
        <p className="tb-tagline" data-testid="settings-tab-body">
          {TAB_BLURB[activeTab]}
        </p>

        <SlotHost
          slot="settings.tabs"
          sections={sections}
          onPlay={onBack}
          onBack={onBack}
          title={brand.title}
        />

        <div className="tb-actions">
          <Button variant="outline" onClick={onBack} data-testid="settings-back">
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}
