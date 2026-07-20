import {
  defaultRuntimeAudioSettings,
  RUNTIME_AUDIO_BINDING_KEYS,
  type RuntimeAudioBusDefinition,
  type RuntimeAudioCueDefinition,
  type RuntimeAudioSettings,
  type RuntimeAudioSourceDefinition,
} from '@tileborne/runtime';
import { Option, Schema } from 'effect';

import type { AudioTabConfig } from '../components/audio-tab.js';

const AudioGain = Schema.Number.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
);

const ShippedAudioSource = Schema.Struct({
  assetId: Schema.optional(Schema.String),
  packId: Schema.optional(Schema.String),
  packVersion: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  mime: Schema.optional(Schema.String),
});

const ShippedAudioBus = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(['music', 'sfx', 'ui']),
  defaultVolume: Schema.Number,
});

const ShippedAudioCue = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  busId: Schema.String,
  defaultVolume: Schema.Number,
  assetId: Schema.optional(Schema.String),
  binding: Schema.optional(Schema.Literals(RUNTIME_AUDIO_BINDING_KEYS)),
  classification: Schema.optional(
    Schema.Literals(['music', 'weapon', 'item', 'player', 'environment', 'match', 'ui', 'sfx']),
  ),
  source: Schema.optional(ShippedAudioSource),
  loop: Schema.optional(Schema.Boolean),
  maxOverlap: Schema.optional(Schema.Number),
});

const ShippedAudioSettings = Schema.Struct({
  masterVolume: AudioGain,
  muted: Schema.Boolean,
  muteOnFocusLoss: Schema.Boolean,
  busVolumes: Schema.optional(Schema.Record(Schema.String, AudioGain)),
});

const ShippedAudioDocument = Schema.Struct({
  buses: Schema.Array(ShippedAudioBus),
  cues: Schema.Array(ShippedAudioCue),
  settings: ShippedAudioSettings,
});

export interface ShippedAudioBootstrap {
  readonly audio: AudioTabConfig;
  readonly sourceUrlBase: string;
}

const isAbsoluteUrl = (value: string): boolean => /^(?:[a-z][a-z\d+\-.]*:|\/)/i.test(value);

const joinRelativeUrl = (base: string, value: string): string =>
  isAbsoluteUrl(value) ? value : `${base.replace(/\/+$/, '')}/${value.replace(/^\/+/, '')}`;

const sourceWithBase = (
  source: RuntimeAudioSourceDefinition | undefined,
  sourceUrlBase: string,
): RuntimeAudioSourceDefinition | undefined => {
  if (source === undefined) return undefined;
  if (source.url !== undefined)
    return { ...source, url: joinRelativeUrl(sourceUrlBase, source.url) };
  if (source.path !== undefined)
    return { ...source, url: joinRelativeUrl(sourceUrlBase, source.path) };
  return source;
};

export const decodeShippedAudioConfig = (
  value: unknown,
  options: {
    readonly sourceUrlBase: string;
    readonly onChange: (settings: RuntimeAudioSettings) => void;
  },
): AudioTabConfig | undefined => {
  const decoded = Schema.decodeUnknownOption(ShippedAudioDocument)(value);
  if (Option.isNone(decoded)) return undefined;
  return {
    buses: decoded.value.buses as readonly RuntimeAudioBusDefinition[],
    cues: decoded.value.cues.map(
      (cue): RuntimeAudioCueDefinition => ({
        ...cue,
        ...(cue.binding === undefined
          ? {}
          : { binding: cue.binding as RuntimeAudioCueDefinition['binding'] }),
        source: sourceWithBase(cue.source, options.sourceUrlBase),
      }),
    ),
    settings: {
      ...decoded.value.settings,
      busVolumes: decoded.value.settings.busVolumes ?? {},
    },
    onChange: options.onChange,
  };
};

export const loadShippedAudioConfig = async (options: {
  readonly fetchImpl?: typeof fetch | undefined;
  readonly mapId: string;
  readonly onChange: (settings: RuntimeAudioSettings) => void;
}): Promise<ShippedAudioBootstrap | undefined> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const mapPackageDirectory = `maps/${options.mapId.replaceAll(':', '-')}`;
  const response = await fetchImpl(`${mapPackageDirectory}/audio.json`).catch(() => undefined);
  if (response === undefined) return undefined;
  if (!response.ok) return undefined;
  const payload = await response.json().catch(() => undefined);
  if (payload === undefined) return undefined;
  const audio = decodeShippedAudioConfig(payload, {
    sourceUrlBase: mapPackageDirectory,
    onChange: options.onChange,
  });
  return audio === undefined
    ? undefined
    : {
        audio: {
          ...audio,
          settings: audio.settings ?? defaultRuntimeAudioSettings(),
        },
        sourceUrlBase: mapPackageDirectory,
      };
};
