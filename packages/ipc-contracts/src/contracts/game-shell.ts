import { Schema } from 'effect';

import { ProjectId } from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { IpcContractErrors } from './common.js';

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const ScreenId = NonEmptyString;

export const GameShellRequiredScreenId = Schema.Literals([
  'title',
  'main-menu',
  'loading',
  'pause',
  'settings',
  'results',
]);

export const GameShellActionType = Schema.Literals([
  'navigate',
  'emit-event',
  'start-single-player',
  'start-multiplayer',
  'resume',
  'open-settings',
  'retry',
  'exit',
]);

export const GameShellRegisteredEvent = Schema.Literals([
  'shell.title.entered',
  'shell.menu.entered',
  'shell.loading.entered',
  'shell.pause.entered',
  'shell.settings.entered',
  'shell.results.entered',
  'shell.action.invoked',
  'shell.navigation.requested',
]);

export const GameShellAsset = Schema.Struct({
  assetId: NonEmptyString,
  packId: NonEmptyString,
  packVersion: NonEmptyString,
  path: NonEmptyString,
  mime: NonEmptyString,
  kind: Schema.Literals(['background', 'font']),
});

export const GameShellTokens = Schema.Struct({
  fontFamily: NonEmptyString,
  textColor: NonEmptyString,
  accentColor: NonEmptyString,
  panelColor: NonEmptyString,
  focusColor: NonEmptyString,
  spacing: Schema.Literals(['compact', 'comfortable', 'spacious']),
  motion: Schema.Literals(['standard', 'reduced']),
});

const GameShellTokenPatch = Schema.Struct({
  fontFamily: Schema.optional(NonEmptyString),
  textColor: Schema.optional(NonEmptyString),
  accentColor: Schema.optional(NonEmptyString),
  panelColor: Schema.optional(NonEmptyString),
  focusColor: Schema.optional(NonEmptyString),
  spacing: Schema.optional(Schema.Literals(['compact', 'comfortable', 'spacious'])),
  motion: Schema.optional(Schema.Literals(['standard', 'reduced'])),
});

export const GameShellAction = Schema.Struct({
  id: NonEmptyString,
  label: NonEmptyString,
  type: GameShellActionType,
  targetScreenId: Schema.optional(ScreenId),
  event: Schema.optional(GameShellRegisteredEvent),
});

export const GameShellScreen = Schema.Struct({
  id: ScreenId,
  stableId: GameShellRequiredScreenId,
  version: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isInt())),
  kind: GameShellRequiredScreenId,
  title: NonEmptyString,
  subtitle: Schema.String,
  enabled: Schema.Boolean,
  backgroundAssetId: Schema.optional(ScreenId),
  fontAssetId: Schema.optional(ScreenId),
  layout: Schema.Literals(['center', 'split', 'stack']),
  actions: Schema.Array(GameShellAction),
});

const validateGameShellDocument = (document: {
  readonly screens: readonly {
    readonly id: string;
    readonly stableId: string;
    readonly backgroundAssetId?: string | undefined;
    readonly fontAssetId?: string | undefined;
  }[];
  readonly screenOrder: readonly string[];
  readonly assets: readonly { readonly assetId: string }[];
  readonly entryScreenId: string;
}) => {
  const screenIds = new Set(document.screens.map((screen) => screen.id));
  const duplicateScreen = document.screens.find(
    (screen, index) => document.screens.findIndex((entry) => entry.id === screen.id) !== index,
  );
  if (duplicateScreen !== undefined)
    return { path: ['screens'], issue: `duplicate shell screen id: ${duplicateScreen.id}` };
  const duplicateStable = document.screens.find(
    (screen, index) =>
      document.screens.findIndex((entry) => entry.stableId === screen.stableId) !== index,
  );
  if (duplicateStable !== undefined)
    return {
      path: ['screens'],
      issue: `duplicate stable shell screen id: ${duplicateStable.stableId}`,
    };
  const missingOrdered = document.screenOrder.find((screenId) => !screenIds.has(screenId));
  if (missingOrdered !== undefined)
    return {
      path: ['screenOrder'],
      issue: `screen order references missing screen ${missingOrdered}`,
    };
  if (!screenIds.has(document.entryScreenId))
    return { path: ['entryScreenId'], issue: `entry screen is missing: ${document.entryScreenId}` };
  const assetIds = new Set(document.assets.map((asset) => asset.assetId));
  for (const screen of document.screens) {
    if (screen.backgroundAssetId !== undefined && !assetIds.has(screen.backgroundAssetId)) {
      return {
        path: ['screens', screen.id, 'backgroundAssetId'],
        issue: `screen ${screen.id} references missing background asset ${screen.backgroundAssetId}`,
      };
    }
    if (screen.fontAssetId !== undefined && !assetIds.has(screen.fontAssetId)) {
      return {
        path: ['screens', screen.id, 'fontAssetId'],
        issue: `screen ${screen.id} references missing font asset ${screen.fontAssetId}`,
      };
    }
  }
  return undefined;
};

export const GameShellDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  pluginId: NonEmptyString,
  screens: Schema.Array(GameShellScreen),
  screenOrder: Schema.Array(ScreenId),
  assets: Schema.Array(GameShellAsset),
  tokens: GameShellTokens,
  entryScreenId: ScreenId,
}).pipe(
  Schema.check(
    Schema.makeFilter(validateGameShellDocument, {
      message: 'game shell document must satisfy durable navigation invariants',
    }),
  ),
);

export const GameShellCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal('apply-plugin-defaults'), pluginId: NonEmptyString }),
  Schema.Struct({
    type: Schema.Literal('set-screen-text'),
    screenId: ScreenId,
    title: NonEmptyString,
    subtitle: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('set-screen-layout'),
    screenId: ScreenId,
    layout: Schema.Literals(['center', 'split', 'stack']),
  }),
  Schema.Struct({
    type: Schema.Literal('set-screen-enabled'),
    screenId: ScreenId,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal('set-screen-order'), screenOrder: Schema.Array(ScreenId) }),
  Schema.Struct({ type: Schema.Literal('set-entry-screen'), screenId: ScreenId }),
  Schema.Struct({ type: Schema.Literal('set-design-tokens'), tokens: GameShellTokenPatch }),
  Schema.Struct({ type: Schema.Literal('register-asset'), asset: GameShellAsset }),
  Schema.Struct({
    type: Schema.Literal('set-screen-asset'),
    screenId: ScreenId,
    slot: Schema.Literals(['background', 'font']),
    assetId: Schema.optional(ScreenId),
  }),
  Schema.Struct({
    type: Schema.Literal('upsert-action'),
    screenId: ScreenId,
    action: GameShellAction,
  }),
  Schema.Struct({ type: Schema.Literal('remove-action'), screenId: ScreenId, actionId: ScreenId }),
]);

const GameShellDiagnostic = Schema.Struct({
  code: Schema.String,
  path: Schema.String,
  message: Schema.String,
});

export const GameShellProjection = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  pluginId: NonEmptyString,
  entryScreenId: ScreenId,
  screens: Schema.Array(GameShellScreen),
  screenOrder: Schema.Array(ScreenId),
  assets: Schema.Array(GameShellAsset),
  tokens: GameShellTokens,
  registeredEvents: Schema.Array(GameShellRegisteredEvent),
  diagnostics: Schema.Array(GameShellDiagnostic),
});

export const GameShellOpenRequest = Schema.Struct({ projectId: ProjectId });
export const GameShellOpenResponse = Schema.Struct({
  document: GameShellDocument,
  projection: GameShellProjection,
});

export const GameShellSaveRequest = Schema.Struct({
  projectId: ProjectId,
  document: GameShellDocument,
});
export const GameShellSaveResponse = GameShellOpenResponse;

export const GameShellApplyRequest = Schema.Struct({
  projectId: ProjectId,
  command: GameShellCommand,
});
export const GameShellApplyResponse = GameShellOpenResponse;

export const GameShellPreviewRequest = Schema.Struct({
  projectId: ProjectId,
  document: GameShellDocument,
});
export const GameShellPreviewResponse = Schema.Struct({ projection: GameShellProjection });

export const GameShellOpenContract = defineContract({
  channel: 'tileborne:game-shell:open',
  request: GameShellOpenRequest,
  response: GameShellOpenResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 10_000 },
});

export const GameShellSaveContract = defineContract({
  channel: 'tileborne:game-shell:save',
  request: GameShellSaveRequest,
  response: GameShellSaveResponse,
  errors: IpcContractErrors,
});

export const GameShellApplyContract = defineContract({
  channel: 'tileborne:game-shell:apply',
  request: GameShellApplyRequest,
  response: GameShellApplyResponse,
  errors: IpcContractErrors,
});

export const GameShellPreviewContract = defineContract({
  channel: 'tileborne:game-shell:preview',
  request: GameShellPreviewRequest,
  response: GameShellPreviewResponse,
  errors: IpcContractErrors,
});

export const GameShellContracts = [
  GameShellOpenContract,
  GameShellSaveContract,
  GameShellApplyContract,
  GameShellPreviewContract,
] as const;

export const GameShellIpcRegistry = createRegistry(GameShellContracts);
