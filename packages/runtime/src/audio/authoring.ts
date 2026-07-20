import { Option, Schema } from 'effect';

import type {
  RuntimeAudioBusDefinition,
  RuntimeAudioCueDefinition,
  RuntimeAudioSettings,
} from './mixer.js';

export const RUNTIME_AUDIO_BINDING_KEYS = [
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
] as const;

export type RuntimeAudioBindingKey = (typeof RUNTIME_AUDIO_BINDING_KEYS)[number];

export type RuntimeAudioClassification =
  | 'music'
  | 'weapon'
  | 'item'
  | 'player'
  | 'environment'
  | 'match'
  | 'ui'
  | 'sfx';

export const PROJECT_AUDIO_DOCUMENT_SETTINGS_KEY = 'tileborne:audio';
export const PROJECT_AUDIO_DOCUMENT_SCHEMA_VERSION = 1;

const AudioGain = Schema.Number.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(0, { message: 'audio volume must be >= 0' }),
    Schema.isLessThanOrEqualTo(1, { message: 'audio volume must be <= 1' }),
  ),
);

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

const RuntimeAudioBindingsDocument = Schema.Record(
  Schema.String,
  Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
).pipe(
  Schema.check(
    Schema.makeFilter(
      (bindings) => {
        const unknown = Object.keys(bindings).filter(
          (binding) => !(RUNTIME_AUDIO_BINDING_KEYS as readonly string[]).includes(binding),
        );
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

export class RuntimeAudioSourceDocument extends Schema.Class<RuntimeAudioSourceDocument>(
  'RuntimeAudioSourceDocument',
)({
  assetId: Schema.optional(Schema.String),
  packId: Schema.optional(Schema.String),
  packVersion: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  mime: Schema.optional(Schema.String),
}) {
  static readonly validate = Schema.Struct({
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
}

export class RuntimeAudioAssetDocument extends Schema.Class<RuntimeAudioAssetDocument>(
  'RuntimeAudioAssetDocument',
)({
  label: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  source: RuntimeAudioSourceDocument.validate,
  classification: Schema.Literals([
    'music',
    'weapon',
    'item',
    'player',
    'environment',
    'match',
    'ui',
    'sfx',
  ]),
}) {}

export class ProjectAudioDocument extends Schema.Class<ProjectAudioDocument>(
  'ProjectAudioDocument',
)({
  schemaVersion: Schema.Literal(PROJECT_AUDIO_DOCUMENT_SCHEMA_VERSION),
  assets: Schema.Array(RuntimeAudioAssetDocument),
  bindings: RuntimeAudioBindingsDocument,
  settings: Schema.Struct({
    masterVolume: AudioGain,
    muted: Schema.Boolean,
    muteOnFocusLoss: Schema.Boolean,
    busVolumes: Schema.optional(Schema.Record(Schema.String, AudioGain)),
  }),
}) {}

export interface RuntimeAudioSourceDefinition {
  readonly assetId?: string | undefined;
  readonly packId?: string | undefined;
  readonly packVersion?: string | undefined;
  readonly url?: string | undefined;
  readonly path?: string | undefined;
  readonly mime?: string | undefined;
}

export interface RuntimeAudioAssetDefinition {
  readonly label: string;
  readonly source: RuntimeAudioSourceDefinition;
  readonly classification: RuntimeAudioClassification;
}

export interface AudioAuthoringState {
  readonly assetsByLabel: Readonly<Record<string, RuntimeAudioAssetDefinition>>;
  readonly bindings: Readonly<Record<RuntimeAudioBindingKey, string>>;
  readonly settings: RuntimeAudioSettings;
}

export interface RuntimeAudioProjection {
  readonly buses: readonly RuntimeAudioBusDefinition[];
  readonly cues: readonly RuntimeAudioCueDefinition[];
  readonly diagnostics: readonly RuntimeAudioDiagnostic[];
  readonly settings: RuntimeAudioSettings;
}

export type AudioAuthoringCommand =
  | {
      readonly type: 'import';
      readonly label: string;
      readonly source: RuntimeAudioSourceDefinition;
      readonly classification: RuntimeAudioClassification;
    }
  | {
      readonly type: 'preview';
      readonly label: string;
    }
  | {
      readonly type: 'classify';
      readonly label: string;
      readonly classification: RuntimeAudioClassification;
    }
  | {
      readonly type: 'bind';
      readonly binding: RuntimeAudioBindingKey;
      readonly label: string;
    }
  | {
      readonly type: 'replace';
      readonly label: string;
      readonly source: RuntimeAudioSourceDefinition;
    }
  | {
      readonly type: 'remove';
      readonly label: string;
    };

export type RuntimeAudioEffect =
  | {
      readonly type: 'preview';
      readonly label: string;
      readonly source: RuntimeAudioSourceDefinition;
    }
  | {
      readonly type: 'play';
      readonly cue: RuntimeAudioCueDefinition;
      readonly loop: boolean;
    }
  | {
      readonly type: 'stop';
      readonly cueId?: string | undefined;
    };

export interface RuntimeAudioDiagnostic {
  readonly code:
    | 'missing-label'
    | 'missing-source'
    | 'unbound-binding'
    | 'unresolved-packaged-source';
  readonly path: string;
  readonly message: string;
}

export interface AudioAuthoringResult {
  readonly state: AudioAuthoringState;
  readonly effects: readonly RuntimeAudioEffect[];
  readonly diagnostics: readonly RuntimeAudioDiagnostic[];
}

const normalizeLabel = (label: string): string => label.trim();

const hasPlayableSource = (source: RuntimeAudioSourceDefinition): boolean =>
  source.url !== undefined || source.path !== undefined || source.assetId !== undefined;

export type RuntimeAudioSourceResolver = (
  source: RuntimeAudioSourceDefinition,
) => RuntimeAudioSourceDefinition | undefined;

const bindingKind = (binding: RuntimeAudioBindingKey): RuntimeAudioClassification => {
  if (binding.startsWith('shell.')) return 'music';
  if (binding.startsWith('weapon.')) return 'weapon';
  if (binding.startsWith('item.')) return 'item';
  if (binding.startsWith('player.')) return 'player';
  if (binding.startsWith('environment.')) return 'environment';
  return 'match';
};

const cueIdForBinding = (binding: RuntimeAudioBindingKey): string => `project.${binding}`;

const sourceDiagnostic = (
  path: string,
  label: string,
  source: RuntimeAudioSourceDefinition,
): RuntimeAudioDiagnostic | undefined =>
  hasPlayableSource(source)
    ? undefined
    : {
        code: 'missing-source',
        path,
        message: `Audio label "${label}" has no packaged source URL, path, or asset id.`,
      };

export const createAudioAuthoringState = (
  input: Partial<AudioAuthoringState> & Pick<AudioAuthoringState, 'settings'>,
): AudioAuthoringState => ({
  assetsByLabel: input.assetsByLabel ?? {},
  bindings: Object.fromEntries(
    Object.entries(input.bindings ?? {}).filter(([binding]) =>
      (RUNTIME_AUDIO_BINDING_KEYS as readonly string[]).includes(binding),
    ),
  ) as Readonly<Record<RuntimeAudioBindingKey, string>>,
  settings: input.settings,
});

export const defaultProjectAudioBuses = (): readonly RuntimeAudioBusDefinition[] => [
  {
    id: 'project.music',
    label: 'Project Music',
    kind: 'music',
    defaultVolume: 0.8,
  },
  {
    id: 'project.sfx',
    label: 'Project SFX',
    kind: 'sfx',
    defaultVolume: 0.85,
  },
];

export const projectAudioDocumentFromState = (state: AudioAuthoringState): ProjectAudioDocument =>
  new ProjectAudioDocument({
    schemaVersion: PROJECT_AUDIO_DOCUMENT_SCHEMA_VERSION,
    assets: Object.values(state.assetsByLabel).map(
      (asset) =>
        new RuntimeAudioAssetDocument({
          label: asset.label,
          source: new RuntimeAudioSourceDocument(asset.source),
          classification: asset.classification,
        }),
    ),
    bindings: state.bindings,
    settings: state.settings,
  });

export const audioAuthoringStateFromDocument = (
  document: ProjectAudioDocument,
): AudioAuthoringState =>
  createAudioAuthoringState({
    assetsByLabel: Object.fromEntries(document.assets.map((asset) => [asset.label, asset])),
    bindings: document.bindings as Readonly<Record<RuntimeAudioBindingKey, string>>,
    settings: document.settings,
  });

export const decodeProjectAudioDocument = (value: unknown): ProjectAudioDocument | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(ProjectAudioDocument)(value));

export const applyAudioAuthoringCommand = (
  state: AudioAuthoringState,
  command: AudioAuthoringCommand,
): AudioAuthoringResult => {
  const diagnostics: RuntimeAudioDiagnostic[] = [];
  const effects: RuntimeAudioEffect[] = [];

  switch (command.type) {
    case 'import': {
      const label = normalizeLabel(command.label);
      const nextAsset: RuntimeAudioAssetDefinition = {
        label,
        source: command.source,
        classification: command.classification,
      };
      const diagnostic = sourceDiagnostic(`audio.assets.${label}.source`, label, command.source);
      if (diagnostic !== undefined) diagnostics.push(diagnostic);
      return {
        state: {
          ...state,
          assetsByLabel: { ...state.assetsByLabel, [label]: nextAsset },
        },
        effects,
        diagnostics,
      };
    }
    case 'preview': {
      const label = normalizeLabel(command.label);
      const asset = state.assetsByLabel[label];
      if (asset === undefined) {
        diagnostics.push({
          code: 'missing-label',
          path: `audio.assets.${label}`,
          message: `Audio label "${label}" is not imported.`,
        });
      } else {
        const diagnostic = sourceDiagnostic(`audio.assets.${label}.source`, label, asset.source);
        if (diagnostic !== undefined) diagnostics.push(diagnostic);
        else effects.push({ type: 'preview', label, source: asset.source });
      }
      return { state, effects, diagnostics };
    }
    case 'classify': {
      const label = normalizeLabel(command.label);
      const asset = state.assetsByLabel[label];
      if (asset === undefined) {
        diagnostics.push({
          code: 'missing-label',
          path: `audio.assets.${label}`,
          message: `Audio label "${label}" is not imported.`,
        });
        return { state, effects, diagnostics };
      }
      return {
        state: {
          ...state,
          assetsByLabel: {
            ...state.assetsByLabel,
            [label]: { ...asset, classification: command.classification },
          },
        },
        effects,
        diagnostics,
      };
    }
    case 'bind': {
      const label = normalizeLabel(command.label);
      const asset = state.assetsByLabel[label];
      if (asset === undefined) {
        diagnostics.push({
          code: 'missing-label',
          path: `audio.bindings.${command.binding}`,
          message: `Cannot bind "${command.binding}" to missing audio label "${label}".`,
        });
        return { state, effects, diagnostics };
      }
      return {
        state: {
          ...state,
          bindings: { ...state.bindings, [command.binding]: label },
        },
        effects,
        diagnostics,
      };
    }
    case 'replace': {
      const label = normalizeLabel(command.label);
      const asset = state.assetsByLabel[label];
      if (asset === undefined) {
        diagnostics.push({
          code: 'missing-label',
          path: `audio.assets.${label}`,
          message: `Cannot replace missing audio label "${label}".`,
        });
        return { state, effects, diagnostics };
      }
      const diagnostic = sourceDiagnostic(`audio.assets.${label}.source`, label, command.source);
      if (diagnostic !== undefined) diagnostics.push(diagnostic);
      return {
        state: {
          ...state,
          assetsByLabel: {
            ...state.assetsByLabel,
            [label]: { ...asset, source: command.source },
          },
        },
        effects,
        diagnostics,
      };
    }
    case 'remove': {
      const label = normalizeLabel(command.label);
      const assetsByLabel = Object.fromEntries(
        Object.entries(state.assetsByLabel).filter(([assetLabel]) => assetLabel !== label),
      ) as Readonly<Record<string, RuntimeAudioAssetDefinition>>;
      const bindings = Object.fromEntries(
        Object.entries(state.bindings).filter(([, boundLabel]) => boundLabel !== label),
      ) as Readonly<Record<RuntimeAudioBindingKey, string>>;
      return {
        state: { ...state, assetsByLabel, bindings },
        effects,
        diagnostics,
      };
    }
  }
};

export const resolveRuntimeAudioSource = (
  source: RuntimeAudioSourceDefinition,
  resolver?: RuntimeAudioSourceResolver | undefined,
): RuntimeAudioSourceDefinition | undefined => {
  if (source.url !== undefined) return source;
  const resolved = resolver?.(source);
  return resolved?.url === undefined ? undefined : { ...source, ...resolved };
};

export const buildRuntimeAudioProjectionFromAuthoring = (
  state: AudioAuthoringState,
  options: { readonly resolveSource?: RuntimeAudioSourceResolver | undefined } = {},
): {
  readonly buses: readonly RuntimeAudioBusDefinition[];
  readonly cues: readonly RuntimeAudioCueDefinition[];
  readonly diagnostics: readonly RuntimeAudioDiagnostic[];
  readonly settings: RuntimeAudioSettings;
} => {
  const diagnostics: RuntimeAudioDiagnostic[] = [];
  const cues: RuntimeAudioCueDefinition[] = [];

  for (const binding of RUNTIME_AUDIO_BINDING_KEYS) {
    const label = state.bindings[binding];
    if (label === undefined) {
      diagnostics.push({
        code: 'unbound-binding',
        path: `audio.bindings.${binding}`,
        message: `Audio binding "${binding}" has no label.`,
      });
      continue;
    }
    const asset = state.assetsByLabel[label];
    if (asset === undefined) {
      diagnostics.push({
        code: 'missing-label',
        path: `audio.bindings.${binding}`,
        message: `Audio binding "${binding}" points at missing label "${label}".`,
      });
      continue;
    }
    const sourceIssue = sourceDiagnostic(`audio.assets.${label}.source`, label, asset.source);
    if (sourceIssue !== undefined) diagnostics.push(sourceIssue);
    const source = resolveRuntimeAudioSource(asset.source, options.resolveSource);
    if (source === undefined) {
      diagnostics.push({
        code: 'unresolved-packaged-source',
        path: `audio.assets.${label}.source`,
        message: `Audio label "${label}" does not resolve to a packaged source URL.`,
      });
    }
    const classification =
      asset.classification === 'sfx' ? bindingKind(binding) : asset.classification;
    cues.push({
      id: cueIdForBinding(binding),
      label,
      busId: classification === 'music' ? 'project.music' : 'project.sfx',
      defaultVolume: classification === 'music' ? 0.8 : 0.75,
      binding,
      classification,
      ...(source === undefined ? {} : { source }),
      loop: binding.startsWith('shell.') || binding.endsWith('ambientLoop'),
      maxOverlap: classification === 'music' ? 1 : 4,
    });
  }

  return { buses: defaultProjectAudioBuses(), cues, diagnostics, settings: state.settings };
};

export const buildRuntimeAudioCuesFromAuthoring = (
  state: AudioAuthoringState,
): {
  readonly cues: readonly RuntimeAudioCueDefinition[];
  readonly diagnostics: readonly RuntimeAudioDiagnostic[];
} => {
  const projection = buildRuntimeAudioProjectionFromAuthoring(state);
  return { cues: projection.cues, diagnostics: projection.diagnostics };
};
