import type {
  EditorCommandContribution,
  EditorInspectorContribution,
  EditorMenuContribution,
  EditorSettingsContribution,
  EditorTabContribution,
  EditorToolContribution,
  RuntimeAssetLoaderContribution,
  RuntimeComponentContribution,
  RuntimeEventContribution,
  RuntimeSystemContribution,
  ServerLootTableContribution,
  ServerMatchmakingContribution,
  ServerRuleContribution,
  ServerScoringContribution,
} from './contributions.js';

export interface EditorContext {
  readonly registerTab: (contribution: EditorTabContribution) => void;
  readonly registerTool: (contribution: EditorToolContribution) => void;
  readonly registerInspector: (contribution: EditorInspectorContribution) => void;
  readonly registerCommand: (contribution: EditorCommandContribution) => void;
  readonly registerMenu: (contribution: EditorMenuContribution) => void;
  readonly registerSettings: (contribution: EditorSettingsContribution) => void;
}

export interface RuntimeContext {
  readonly registerSystem: (contribution: RuntimeSystemContribution) => void;
  readonly registerComponent: (contribution: RuntimeComponentContribution) => void;
  readonly registerEvent: (contribution: RuntimeEventContribution) => void;
  readonly registerAssetLoader: (contribution: RuntimeAssetLoaderContribution) => void;
}

export interface ServerContext {
  readonly registerRule: (contribution: ServerRuleContribution) => void;
  readonly registerScoring: (contribution: ServerScoringContribution) => void;
  readonly registerLootTable: (contribution: ServerLootTableContribution) => void;
  readonly registerMatchmaking: (contribution: ServerMatchmakingContribution) => void;
}

export interface TilebornePluginContext {
  readonly editor: EditorContext;
  readonly runtime: RuntimeContext;
  readonly server: ServerContext;
}
