import type {
  RuntimeAudioBindingKey,
  RuntimeAudioClassification,
  RuntimeAudioSourceDefinition,
} from './authoring.js';

export type RuntimeAudioBusKind = 'music' | 'sfx' | 'ui';

export interface RuntimeAudioBusDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: RuntimeAudioBusKind;
  readonly defaultVolume: number;
}

export interface RuntimeAudioCueDefinition {
  readonly id: string;
  readonly label: string;
  readonly busId: string;
  readonly defaultVolume: number;
  readonly assetId?: string | undefined;
  readonly binding?: RuntimeAudioBindingKey | undefined;
  readonly classification?: RuntimeAudioClassification | undefined;
  readonly source?: RuntimeAudioSourceDefinition | undefined;
  readonly loop?: boolean | undefined;
  readonly maxOverlap?: number | undefined;
}

export interface RuntimeAudioSettings {
  readonly masterVolume: number;
  readonly muted: boolean;
  readonly muteOnFocusLoss: boolean;
  readonly busVolumes?: Readonly<Record<string, number>> | undefined;
}

export type RuntimeAudioFocusState = 'focused' | 'backgrounded';

export type RuntimeAudioMuteReason = 'master-muted' | 'focus-muted' | 'zero-gain';

export interface ResolvedAudioPlayback {
  readonly cueId: string;
  readonly busId: string;
  readonly gain: number;
  readonly audible: boolean;
  readonly loop: boolean;
  readonly maxOverlap: number;
  readonly source?: RuntimeAudioSourceDefinition | undefined;
  readonly mutedReason?: RuntimeAudioMuteReason | undefined;
}

export const defaultRuntimeAudioSettings = (): RuntimeAudioSettings => ({
  masterVolume: 1,
  muted: false,
  muteOnFocusLoss: true,
  busVolumes: {},
});

export const clampAudioGain = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
};

export const resolveAudioBusGain = (
  bus: RuntimeAudioBusDefinition,
  settings: RuntimeAudioSettings,
  focusState: RuntimeAudioFocusState,
): { readonly gain: number; readonly mutedReason?: RuntimeAudioMuteReason | undefined } => {
  if (settings.muted) {
    return { gain: 0, mutedReason: 'master-muted' };
  }
  if (settings.muteOnFocusLoss && focusState === 'backgrounded') {
    return { gain: 0, mutedReason: 'focus-muted' };
  }

  const masterGain = clampAudioGain(settings.masterVolume);
  const busGain = clampAudioGain(settings.busVolumes?.[bus.id] ?? bus.defaultVolume);
  const gain = clampAudioGain(masterGain * busGain);
  return gain > 0 ? { gain } : { gain: 0, mutedReason: 'zero-gain' };
};

export const resolveAudioCuePlayback = (
  cue: RuntimeAudioCueDefinition,
  bus: RuntimeAudioBusDefinition,
  settings: RuntimeAudioSettings,
  focusState: RuntimeAudioFocusState,
  requestVolume = 1,
): ResolvedAudioPlayback => {
  if (cue.busId !== bus.id) {
    throw new Error(
      `Audio cue "${cue.id}" targets bus "${cue.busId}", but bus "${bus.id}" was provided.`,
    );
  }

  const busGain = resolveAudioBusGain(bus, settings, focusState);
  const gain = clampAudioGain(
    busGain.gain * clampAudioGain(cue.defaultVolume) * clampAudioGain(requestVolume),
  );
  const mutedReason = busGain.mutedReason ?? (gain > 0 ? undefined : 'zero-gain');
  return {
    cueId: cue.id,
    busId: bus.id,
    gain,
    audible: gain > 0,
    loop: cue.loop ?? false,
    maxOverlap: Math.max(1, Math.floor(cue.maxOverlap ?? 8)),
    ...(cue.source === undefined ? {} : { source: cue.source }),
    ...(mutedReason === undefined ? {} : { mutedReason }),
  };
};
