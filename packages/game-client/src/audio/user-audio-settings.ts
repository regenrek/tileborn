import { PERSISTED_SCHEMA_VERSIONS } from '@tileborne/core';

import type { AudioSettingsValue } from '../components/audio-tab.js';

export type AudioUserSettingsValue = AudioSettingsValue;

export interface AudioUserSettingsStore {
  readonly key: string;
  load(): AudioUserSettingsValue | undefined;
  save(settings: AudioUserSettingsValue): void;
}

export const AUDIO_USER_SETTINGS_STORAGE_KEY = `tileborne.game-client.audio-settings.v${PERSISTED_SCHEMA_VERSIONS.audioUserSettings}`;

const normalizeAudioUserSettings = (settings: AudioUserSettingsValue): AudioUserSettingsValue => ({
  ...settings,
  busVolumes: settings.busVolumes ?? {},
});

const isAudioUserSettingsValue = (value: unknown): value is AudioUserSettingsValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.masterVolume === 'number' &&
    record.masterVolume >= 0 &&
    record.masterVolume <= 1 &&
    typeof record.muted === 'boolean' &&
    typeof record.muteOnFocusLoss === 'boolean' &&
    (record.busVolumes === undefined ||
      (typeof record.busVolumes === 'object' &&
        record.busVolumes !== null &&
        !Array.isArray(record.busVolumes) &&
        Object.values(record.busVolumes).every(
          (value) => typeof value === 'number' && value >= 0 && value <= 1,
        )))
  );
};

export const createAudioUserSettingsStore = (options?: {
  readonly storage?: Storage | undefined;
  readonly key?: string | undefined;
}): AudioUserSettingsStore => {
  const storage =
    options?.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  const key = options?.key ?? AUDIO_USER_SETTINGS_STORAGE_KEY;
  return {
    key,
    load: () => {
      if (storage === undefined) return undefined;
      try {
        const raw = storage.getItem(key);
        if (raw === null) return undefined;
        const parsed = JSON.parse(raw) as unknown;
        return isAudioUserSettingsValue(parsed) ? normalizeAudioUserSettings(parsed) : undefined;
      } catch {
        return undefined;
      }
    },
    save: (settings) => {
      if (storage === undefined) return;
      storage.setItem(key, JSON.stringify(normalizeAudioUserSettings(settings)));
    },
  };
};
