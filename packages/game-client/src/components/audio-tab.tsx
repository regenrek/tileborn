import type { ReactElement } from 'react';
import type { RuntimeAudioBusDefinition, RuntimeAudioCueDefinition } from '@tileborne/runtime';

import type {
  BrowserRuntimeAudioEngineConfig,
  RuntimeAudioPlaybackEngine,
} from '../audio/browser-audio-engine.js';

export type AudioBusControl = RuntimeAudioBusDefinition;

export interface AudioSettingsValue {
  readonly masterVolume: number;
  readonly muted: boolean;
  readonly muteOnFocusLoss: boolean;
  readonly busVolumes: Readonly<Record<string, number>>;
}

export interface AudioTabConfig {
  readonly settings: AudioSettingsValue;
  readonly buses: readonly AudioBusControl[];
  readonly cues?: readonly RuntimeAudioCueDefinition[] | undefined;
  readonly engineFactory?:
    | ((config: BrowserRuntimeAudioEngineConfig) => RuntimeAudioPlaybackEngine)
    | undefined;
  readonly onChange: (settings: AudioSettingsValue) => void;
}

const percent = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 100);

const fromPercent = (value: string): number => Math.min(1, Math.max(0, Number(value) / 100));

const busLabel = (bus: AudioBusControl): string => `${bus.label} ${percentLabel(bus.kind)}`;

const percentLabel = (kind: AudioBusControl['kind']): string => {
  switch (kind) {
    case 'music':
      return 'music';
    case 'sfx':
      return 'sfx';
    case 'ui':
      return 'ui';
  }
};

export function AudioTab({ settings, buses, onChange }: AudioTabConfig): ReactElement {
  const update = (patch: Partial<AudioSettingsValue>) => onChange({ ...settings, ...patch });
  const updateBusVolume = (busId: string, volume: number) =>
    update({ busVolumes: { ...settings.busVolumes, [busId]: volume } });

  return (
    <div className="tb-audio-tab" data-testid="audio-settings">
      <label className="tb-audio-toggle">
        <input
          type="checkbox"
          checked={settings.muted}
          onChange={(event) => update({ muted: event.currentTarget.checked })}
          data-testid="audio-muted"
        />
        <span>Mute</span>
      </label>
      <label className="tb-audio-toggle">
        <input
          type="checkbox"
          checked={settings.muteOnFocusLoss}
          onChange={(event) => update({ muteOnFocusLoss: event.currentTarget.checked })}
          data-testid="audio-mute-on-focus-loss"
        />
        <span>Mute on focus loss</span>
      </label>
      <label className="tb-audio-slider">
        <span>Master</span>
        <input
          type="range"
          min="0"
          max="100"
          value={percent(settings.masterVolume)}
          aria-label="Master volume"
          onChange={(event) => update({ masterVolume: fromPercent(event.currentTarget.value) })}
          data-testid="audio-master-volume"
        />
        <output>{percent(settings.masterVolume)}%</output>
      </label>
      {buses.map((bus) => {
        const value = settings.busVolumes[bus.id] ?? bus.defaultVolume;
        return (
          <label key={bus.id} className="tb-audio-slider">
            <span>{busLabel(bus)}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={percent(value)}
              aria-label={`${bus.label} volume`}
              onChange={(event) => updateBusVolume(bus.id, fromPercent(event.currentTarget.value))}
              data-testid={`audio-bus-${bus.id}`}
            />
            <output>{percent(value)}%</output>
          </label>
        );
      })}
    </div>
  );
}
