import { Schema } from 'effect';

import { HudLayout, JsonObject, MapId, PluginId, ProjectId } from '@tileborne/core';
import {
  ContributionId,
  GameSettingsScope,
  PluginContributionZone,
} from '@tileborne/plugin-api/preload';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { EmptyResponse, IpcContractErrors } from './common.js';

export const PluginSummary = Schema.Struct({
  id: PluginId,
  version: Schema.String,
  enabled: Schema.Boolean,
  rootPath: Schema.String,
  manifestPath: Schema.String,
});

export const PluginManifestView = Schema.Struct({
  id: PluginId,
  version: Schema.String,
  name: Schema.String,
  engine: Schema.String,
  displayName: Schema.String,
  description: Schema.String,
  author: Schema.String,
  license: Schema.String,
  contributes: JsonObject,
  permissions: Schema.Array(Schema.String),
});

const PluginContributionBaseView = {
  pluginId: PluginId,
  pluginName: Schema.String,
  id: ContributionId,
  zone: PluginContributionZone,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  group: Schema.optional(Schema.String),
  order: Schema.optional(Schema.Number),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
  data: Schema.optional(JsonObject),
};

export const PluginPanelContributionView = Schema.Struct(PluginContributionBaseView);

export const PluginToolContributionView = Schema.Struct({
  ...PluginContributionBaseView,
  commandId: Schema.optional(ContributionId),
});

export const GameSettingsFieldView = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  min: Schema.UndefinedOr(Schema.Number),
  max: Schema.UndefinedOr(Schema.Number),
  step: Schema.UndefinedOr(Schema.Number),
  default: Schema.Number,
});

export const GameSettingsFormView = Schema.Struct({
  scope: GameSettingsScope,
  fields: Schema.Array(GameSettingsFieldView),
  invalidMessage: Schema.String,
});

export const GameModeStarterView = Schema.Struct({
  templateId: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
});

export const GameModeCreatorChecklistFactView = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
  sources: Schema.Array(Schema.Literals(['game-mode', 'map', 'catalog', 'asset', 'visual-model'])),
});

export const PluginsListRequest = Schema.Struct({});
export const PluginsListResponse = Schema.Struct({
  plugins: Schema.Array(PluginSummary),
});

export const PluginsInstallRequest = Schema.Struct({
  source: Schema.Unknown,
});
export const PluginsInstallResponse = Schema.Struct({
  plugin: PluginSummary,
});
export const PluginsInstallBundledBattleRoyaleRequest = Schema.Struct({});
export const PluginsInstallBundledBattleRoyaleResponse = PluginsInstallResponse;

export const PluginsUninstallRequest = Schema.Struct({
  pluginId: PluginId,
});

export const PluginsEnableRequest = Schema.Struct({
  pluginId: PluginId,
});
export const PluginsEnableResponse = Schema.Struct({
  plugin: PluginSummary,
});

export const PluginsDisableRequest = Schema.Struct({
  pluginId: PluginId,
});
export const PluginsDisableResponse = PluginsEnableResponse;

export const PluginsGetManifestRequest = Schema.Struct({
  pluginId: PluginId,
});
export const PluginsGetManifestResponse = Schema.Struct({
  manifest: PluginManifestView,
});

/**
 * A discovered game mode projected to the renderer (ADR-0023 section B). The
 * main process runs `discoverGameModes` over the enabled plugin manifests; the
 * renderer consumes this list to mount the active mode's authoring panel and to
 * resolve playtest — by discovery, never by a hardcoded plugin-id literal.
 */
export const GameModeView = Schema.Struct({
  modeId: Schema.String,
  pluginId: PluginId,
  label: Schema.String,
  runtimeSystemId: Schema.optional(Schema.String),
  authoringSettingsPanelId: Schema.optional(Schema.String),
  authoringCapabilityId: Schema.optional(Schema.String),
  rendererCapabilityId: Schema.optional(Schema.String),
  readinessCapabilityId: Schema.optional(Schema.String),
  starterCapabilityId: Schema.optional(Schema.String),
  gameSettingsFormId: Schema.optional(Schema.String),
  gameSettingsForm: Schema.optional(GameSettingsFormView),
  hudLayoutContributionId: Schema.optional(Schema.String),
  /**
   * The mode's default in-match HUD layout discovered from the plugin's
   * `runtime.hudLayouts` contribution (the engine-owned `@tileborne/core`
   * `HudLayout` shape). The renderer playtest layers the user's HUD overlay on
   * top via `resolveEffectiveHudLayout`.
   */
  hudLayout: Schema.optional(HudLayout),
  mapValidatorId: Schema.optional(Schema.String),
  starter: Schema.optional(GameModeStarterView),
  creatorChecklistFacts: Schema.Array(GameModeCreatorChecklistFactView),
  hasAuthoringPanel: Schema.Boolean,
});

export const PluginsListContributionsRequest = Schema.Struct({});
export const PluginsListContributionsResponse = Schema.Struct({
  panels: Schema.Array(PluginPanelContributionView),
  tools: Schema.Array(PluginToolContributionView),
  gameModes: Schema.Array(GameModeView),
});

export const PluginsListContract = defineContract({
  channel: 'tileborne:plugins:list',
  request: PluginsListRequest,
  response: PluginsListResponse,
  errors: IpcContractErrors,
});

export const PluginsInstallContract = defineContract({
  channel: 'tileborne:plugins:install',
  request: PluginsInstallRequest,
  response: PluginsInstallResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 120_000, requiresApproval: true },
});

export const PluginsInstallBundledBattleRoyaleContract = defineContract({
  channel: 'tileborne:plugins:installBundledBattleRoyale',
  request: PluginsInstallBundledBattleRoyaleRequest,
  response: PluginsInstallBundledBattleRoyaleResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 120_000, requiresApproval: true },
});

export const PluginsUninstallContract = defineContract({
  channel: 'tileborne:plugins:uninstall',
  request: PluginsUninstallRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 60_000, requiresApproval: true },
});

export const PluginsEnableContract = defineContract({
  channel: 'tileborne:plugins:enable',
  request: PluginsEnableRequest,
  response: PluginsEnableResponse,
  errors: IpcContractErrors,
});

export const PluginsDisableContract = defineContract({
  channel: 'tileborne:plugins:disable',
  request: PluginsDisableRequest,
  response: PluginsDisableResponse,
  errors: IpcContractErrors,
});

export const PluginsGetManifestContract = defineContract({
  channel: 'tileborne:plugins:getManifest',
  request: PluginsGetManifestRequest,
  response: PluginsGetManifestResponse,
  errors: IpcContractErrors,
});

export const PluginsListContributionsContract = defineContract({
  channel: 'tileborne:plugins:listContributions',
  request: PluginsListContributionsRequest,
  response: PluginsListContributionsResponse,
  errors: IpcContractErrors,
});

export const PluginsInvokeEditorCommandRequest = Schema.Struct({
  pluginId: PluginId,
  contributionId: Schema.String,
  projectId: Schema.optional(ProjectId),
  mapId: Schema.optional(MapId),
});
export const PluginsInvokeEditorCommandResponse = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
});

export const PluginsInvokeEditorCommandContract = defineContract({
  channel: 'tileborne:plugins:invokeEditorCommand',
  request: PluginsInvokeEditorCommandRequest,
  response: PluginsInvokeEditorCommandResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 60_000 },
});

export const PluginsContracts = [
  PluginsListContract,
  PluginsInstallContract,
  PluginsInstallBundledBattleRoyaleContract,
  PluginsUninstallContract,
  PluginsEnableContract,
  PluginsDisableContract,
  PluginsGetManifestContract,
  PluginsListContributionsContract,
  PluginsInvokeEditorCommandContract,
] as const;

export const PluginsIpcRegistry = createRegistry(PluginsContracts);
