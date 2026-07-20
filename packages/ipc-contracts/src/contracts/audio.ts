import { Schema } from 'effect';

import { ProjectId } from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { IpcContractErrors } from './common.js';

const validateAudioSourceInvariants = (source: {
  readonly assetId?: string | undefined;
  readonly packId?: string | undefined;
  readonly packVersion?: string | undefined;
  readonly url?: string | undefined;
  readonly path?: string | undefined;
  readonly mime?: string | undefined;
}) => {
  const hasUrl = source.url !== undefined;
  const hasPath = source.path !== undefined;
  const hasAssetId = source.assetId !== undefined;
  if (!hasUrl && !hasPath && !hasAssetId) {
    return {
      path: ['source'],
      issue: 'audio source must include a data/url source or a packaged path',
    };
  }
  if (hasUrl && (hasPath || hasAssetId)) {
    return {
      path: ['source'],
      issue: 'audio source url must not be mixed with packaged asset fields',
    };
  }
  if (hasAssetId && !hasPath) {
    return {
      path: ['source', 'path'],
      issue: 'packaged audio source with assetId must include its pack-relative path',
    };
  }
  if ((source.packId !== undefined || source.packVersion !== undefined) && !hasAssetId) {
    return {
      path: ['source', 'assetId'],
      issue: 'packaged audio source owner must reference an asset id',
    };
  }
  if (source.packId !== undefined && source.packVersion === undefined) {
    return {
      path: ['source', 'packVersion'],
      issue: 'packaged audio source owner must include the asset pack version',
    };
  }
  if (source.packVersion !== undefined && source.packId === undefined) {
    return {
      path: ['source', 'packId'],
      issue: 'packaged audio source owner must include the asset pack id',
    };
  }
  if ((hasUrl || hasPath) && source.mime !== undefined && !source.mime.startsWith('audio/')) {
    return {
      path: ['source', 'mime'],
      issue: 'audio source mime must start with audio/',
    };
  }
  return undefined;
};

export const AudioSource = Schema.Struct({
  assetId: Schema.optional(Schema.String),
  packId: Schema.optional(Schema.String),
  packVersion: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  mime: Schema.optional(Schema.String),
}).pipe(
  Schema.check(
    Schema.makeFilter(validateAudioSourceInvariants, {
      message: 'audio source must satisfy durable source invariants',
    }),
  ),
);

export const AudioClassification = Schema.Literals([
  'music',
  'weapon',
  'item',
  'player',
  'environment',
  'match',
  'ui',
  'sfx',
]);

export const AudioBinding = Schema.Literals([
  'shell.titleMusic',
  'shell.menuMusic',
  'shell.loadingMusic',
  'shell.pauseMusic',
  'shell.resultsMusic',
  'weapon.fire',
  'weapon.reload',
  'item.collect',
  'player.hit',
  'player.eliminated',
  'environment.zoneWarning',
  'environment.ambientLoop',
  'match.start',
  'match.end',
]);

const AudioGain = Schema.Number.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
);

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const AudioBindings = Schema.Record(Schema.String, NonEmptyString).pipe(
  Schema.check(
    Schema.makeFilter(
      (bindings) => {
        const allowed = new Set(AudioBinding.literals as readonly string[]);
        const unknown = Object.keys(bindings).filter((binding) => !allowed.has(binding));
        return unknown.length === 0
          ? undefined
          : {
              path: ['bindings'],
              issue: `unknown audio binding key(s): ${unknown.join(', ')}`,
            };
      },
      { message: 'audio bindings must use known runtime binding keys' },
    ),
  ),
);

export const AudioAsset = Schema.Struct({
  label: NonEmptyString,
  source: AudioSource,
  classification: AudioClassification,
});

export const AudioDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  assets: Schema.Array(AudioAsset),
  bindings: AudioBindings,
  settings: Schema.Struct({
    masterVolume: AudioGain,
    muted: Schema.Boolean,
    muteOnFocusLoss: Schema.Boolean,
    busVolumes: Schema.optional(Schema.Record(Schema.String, AudioGain)),
  }),
});

export const AudioCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('import'),
    label: Schema.String,
    source: AudioSource,
    classification: AudioClassification,
  }),
  Schema.Struct({ type: Schema.Literal('preview'), label: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('classify'),
    label: Schema.String,
    classification: AudioClassification,
  }),
  Schema.Struct({
    type: Schema.Literal('bind'),
    binding: AudioBinding,
    label: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal('replace'), label: Schema.String, source: AudioSource }),
  Schema.Struct({ type: Schema.Literal('remove'), label: Schema.String }),
]);

export const AudioOpenRequest = Schema.Struct({ projectId: ProjectId });
export const AudioOpenResponse = Schema.Struct({ document: AudioDocument });

export const AudioSaveRequest = Schema.Struct({ projectId: ProjectId, document: AudioDocument });
export const AudioSaveResponse = AudioOpenResponse;

export const AudioApplyRequest = Schema.Struct({ projectId: ProjectId, command: AudioCommand });
const AudioDiagnostic = Schema.Struct({
  code: Schema.String,
  path: Schema.String,
  message: Schema.String,
});
export const AudioApplyResponse = Schema.Struct({
  document: AudioDocument,
  projection: Schema.Struct({
    buses: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        label: Schema.String,
        kind: Schema.Literals(['music', 'sfx', 'ui']),
        defaultVolume: Schema.Number,
      }),
    ),
    cues: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        label: Schema.String,
        busId: Schema.String,
        defaultVolume: Schema.Number,
        assetId: Schema.optional(Schema.String),
        binding: Schema.optional(Schema.String),
        classification: Schema.optional(AudioClassification),
        source: Schema.optional(AudioSource),
        loop: Schema.optional(Schema.Boolean),
        maxOverlap: Schema.optional(Schema.Number),
      }),
    ),
    diagnostics: Schema.Array(AudioDiagnostic),
    settings: Schema.Struct({
      masterVolume: AudioGain,
      muted: Schema.Boolean,
      muteOnFocusLoss: Schema.Boolean,
      busVolumes: Schema.optional(Schema.Record(Schema.String, AudioGain)),
    }),
  }),
});

export const AudioPreviewRequest = Schema.Struct({ projectId: ProjectId, label: Schema.String });
export const AudioPreviewResponse = Schema.Struct({
  playable: Schema.Boolean,
  source: Schema.optional(AudioSource),
  diagnostics: Schema.Array(AudioDiagnostic),
});

export const AudioOpenContract = defineContract({
  channel: 'tileborne:audio:open',
  request: AudioOpenRequest,
  response: AudioOpenResponse,
  errors: IpcContractErrors,
});

export const AudioSaveContract = defineContract({
  channel: 'tileborne:audio:save',
  request: AudioSaveRequest,
  response: AudioSaveResponse,
  errors: IpcContractErrors,
});

export const AudioApplyContract = defineContract({
  channel: 'tileborne:audio:apply',
  request: AudioApplyRequest,
  response: AudioApplyResponse,
  errors: IpcContractErrors,
});

export const AudioPreviewContract = defineContract({
  channel: 'tileborne:audio:preview',
  request: AudioPreviewRequest,
  response: AudioPreviewResponse,
  errors: IpcContractErrors,
});

export const AudioContracts = [
  AudioOpenContract,
  AudioSaveContract,
  AudioApplyContract,
  AudioPreviewContract,
] as const;

export const AudioIpcRegistry = createRegistry(AudioContracts);
