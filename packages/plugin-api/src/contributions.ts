import { JsonObject, PluginId, type SchemaMigrationChain } from "@tileborne/core";
import { License } from "@tileborne/asset-pipeline";
import { Option, Schema } from "effect";

import { DuplicateContributionError } from "./errors.js";
import { ContributionId } from "./primitives.js";

const IconName = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+:[a-z0-9-]+[a-z0-9-_.]*$/i));

export class ContributionDisplay extends Schema.Class<ContributionDisplay>("ContributionDisplay")({
  label: Schema.String,
  description: Schema.OptionFromUndefinedOr(Schema.String),
  icon: Schema.OptionFromUndefinedOr(IconName),
  order: Schema.OptionFromUndefinedOr(Schema.Number),
}) {}

export const PluginContributionZone = Schema.Literals(["project", "working-palette", "assets", "plugins"]);
export type PluginContributionZone = typeof PluginContributionZone.Type;

const ContributionCapability = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9.-]*$/i));

export class PluginPanelContribution extends Schema.Class<PluginPanelContribution>("PluginPanelContribution")({
  id: ContributionId,
  zone: PluginContributionZone,
  title: Schema.String,
  description: Schema.OptionFromUndefinedOr(Schema.String),
  group: Schema.OptionFromUndefinedOr(Schema.String),
  order: Schema.OptionFromUndefinedOr(Schema.Number),
  capabilities: Schema.OptionFromUndefinedOr(Schema.Array(ContributionCapability)),
  data: Schema.OptionFromUndefinedOr(JsonObject),
}) {}

export class PluginToolContribution extends Schema.Class<PluginToolContribution>("PluginToolContribution")({
  id: ContributionId,
  zone: PluginContributionZone,
  title: Schema.String,
  description: Schema.OptionFromUndefinedOr(Schema.String),
  group: Schema.OptionFromUndefinedOr(Schema.String),
  order: Schema.OptionFromUndefinedOr(Schema.Number),
  commandId: Schema.OptionFromUndefinedOr(ContributionId),
  capabilities: Schema.OptionFromUndefinedOr(Schema.Array(ContributionCapability)),
  data: Schema.OptionFromUndefinedOr(JsonObject),
}) {}

export class ExecutableRef extends Schema.Class<ExecutableRef>("ExecutableRef")({
  kind: Schema.Literal("executable"),
  entry: Schema.String,
}) {}

const DeclarativeKind = Schema.Literal("declarative");
const ExecutableKind = Schema.Literal("executable");

const defineDeclarativeContributionSlot = <const SlotName extends string>(slotName: SlotName) => {
  const tag = `Declarative${slotName}Contribution` as const;
  class DeclarativeContribution extends Schema.TaggedClass<DeclarativeContribution>()(tag, {
    id: ContributionId,
    kind: DeclarativeKind,
    display: Schema.OptionFromUndefinedOr(ContributionDisplay),
    data: JsonObject,
  }) {}
  return Schema.Union([DeclarativeContribution]);
};

const defineExecutableContributionSlot = <const SlotName extends string>(slotName: SlotName) => {
  const tag = `Executable${slotName}Contribution` as const;
  class ExecutableContribution extends Schema.TaggedClass<ExecutableContribution>()(tag, {
    id: ContributionId,
    kind: ExecutableKind,
    display: Schema.OptionFromUndefinedOr(ContributionDisplay),
    entry: Schema.String,
  }) {}
  return Schema.Union([ExecutableContribution]);
};

const defineHybridContributionSlot = <const SlotName extends string>(slotName: SlotName) => {
  const declarativeTag = `Declarative${slotName}Contribution` as const;
  const executableTag = `Executable${slotName}Contribution` as const;
  class DeclarativeContribution extends Schema.TaggedClass<DeclarativeContribution>()(declarativeTag, {
    id: ContributionId,
    kind: DeclarativeKind,
    display: Schema.OptionFromUndefinedOr(ContributionDisplay),
    data: JsonObject,
  }) {}
  class ExecutableContribution extends Schema.TaggedClass<ExecutableContribution>()(executableTag, {
    id: ContributionId,
    kind: ExecutableKind,
    display: Schema.OptionFromUndefinedOr(ContributionDisplay),
    entry: Schema.String,
  }) {}
  return Schema.Union([DeclarativeContribution, ExecutableContribution]);
};

export class AssetPackContribution extends Schema.TaggedClass<AssetPackContribution>()(
  "AssetPackContribution",
  {
    id: ContributionId,
    name: Schema.String,
    path: Schema.String,
    license: License,
  },
) {}

export const TilesetPackContribution = AssetPackContribution;
export type TilesetPackContribution = AssetPackContribution;

export class TiledImportProfileContribution extends Schema.Class<TiledImportProfileContribution>(
  "TiledImportProfileContribution",
)({
  id: ContributionId,
  displayName: Schema.String,
  transformPlan: Schema.Unknown,
}) {}

export const EditorTabContribution = defineHybridContributionSlot("EditorTab");
export type EditorTabContribution = typeof EditorTabContribution.Type;

export const EditorToolContribution = defineHybridContributionSlot("EditorTool");
export type EditorToolContribution = typeof EditorToolContribution.Type;

export const EditorInspectorContribution = defineHybridContributionSlot("EditorInspector");
export type EditorInspectorContribution = typeof EditorInspectorContribution.Type;

export const EditorCommandContribution = defineHybridContributionSlot("EditorCommand");
export type EditorCommandContribution = typeof EditorCommandContribution.Type;

export const EditorMenuContribution = defineHybridContributionSlot("EditorMenu");
export type EditorMenuContribution = typeof EditorMenuContribution.Type;

export const EditorSettingsContribution = defineHybridContributionSlot("EditorSettings");
export type EditorSettingsContribution = typeof EditorSettingsContribution.Type;

export const EditorPaletteCategoryContribution = defineDeclarativeContributionSlot("EditorPaletteCategory");
export type EditorPaletteCategoryContribution = typeof EditorPaletteCategoryContribution.Type;

export const EditorPaletteSubFilterContribution = defineDeclarativeContributionSlot("EditorPaletteSubFilter");
export type EditorPaletteSubFilterContribution = typeof EditorPaletteSubFilterContribution.Type;

export const EditorPaletteItemActionContribution = defineDeclarativeContributionSlot("EditorPaletteItemAction");
export type EditorPaletteItemActionContribution = typeof EditorPaletteItemActionContribution.Type;

export const EditorViewportActionContribution = defineDeclarativeContributionSlot("EditorViewportAction");
export type EditorViewportActionContribution = typeof EditorViewportActionContribution.Type;

export const EditorToolDockContribution = defineHybridContributionSlot("EditorToolDock");
export type EditorToolDockContribution = typeof EditorToolDockContribution.Type;

export const EditorOverlayContribution = defineHybridContributionSlot("EditorOverlay");
export type EditorOverlayContribution = typeof EditorOverlayContribution.Type;

export const EditorInspectorPanelContribution = defineDeclarativeContributionSlot("EditorInspectorPanel");
export type EditorInspectorPanelContribution = typeof EditorInspectorPanelContribution.Type;

export const EditorSettingsPanelContribution = defineDeclarativeContributionSlot("EditorSettingsPanel");
export type EditorSettingsPanelContribution = typeof EditorSettingsPanelContribution.Type;

export const EditorMapKindContribution = defineDeclarativeContributionSlot("EditorMapKind");
export type EditorMapKindContribution = typeof EditorMapKindContribution.Type;

export const EditorPresetContribution = defineDeclarativeContributionSlot("EditorPreset");
export type EditorPresetContribution = typeof EditorPresetContribution.Type;

export const EditorPanelContribution = defineDeclarativeContributionSlot("EditorPanel");
export type EditorPanelContribution = typeof EditorPanelContribution.Type;

export const EditorValidatorContribution = defineHybridContributionSlot("EditorValidator");
export type EditorValidatorContribution = typeof EditorValidatorContribution.Type;

export const EditorExporterContribution = defineExecutableContributionSlot("EditorExporter");
export type EditorExporterContribution = typeof EditorExporterContribution.Type;

export const EditorGeneratorContribution = defineExecutableContributionSlot("EditorGenerator");
export type EditorGeneratorContribution = typeof EditorGeneratorContribution.Type;

export const EditorAssetMetadataContribution = defineDeclarativeContributionSlot("EditorAssetMetadata");
export type EditorAssetMetadataContribution = typeof EditorAssetMetadataContribution.Type;

/**
 * Declares a game-mode's player-model POLICY (fixed single model vs a
 * selectable model set). Mirrors the PaletteActionContribution precedent: the
 * plugin declares the policy, the generic editor resolves it. The concrete
 * model set + mode live in `data` (a JsonObject the consuming editor decodes).
 */
export const EditorPlayerModelPolicyContribution = defineDeclarativeContributionSlot("EditorPlayerModelPolicy");
export type EditorPlayerModelPolicyContribution = typeof EditorPlayerModelPolicyContribution.Type;

export class EditorContributions extends Schema.Class<EditorContributions>("EditorContributions")({
  tabs: Schema.OptionFromUndefinedOr(Schema.Array(EditorTabContribution)),
  tools: Schema.OptionFromUndefinedOr(Schema.Array(EditorToolContribution)),
  inspectors: Schema.OptionFromUndefinedOr(Schema.Array(EditorInspectorContribution)),
  commands: Schema.OptionFromUndefinedOr(Schema.Array(EditorCommandContribution)),
  menus: Schema.OptionFromUndefinedOr(Schema.Array(EditorMenuContribution)),
  settings: Schema.OptionFromUndefinedOr(Schema.Array(EditorSettingsContribution)),
  paletteCategories: Schema.OptionFromUndefinedOr(Schema.Array(EditorPaletteCategoryContribution)),
  paletteSubFilters: Schema.OptionFromUndefinedOr(Schema.Array(EditorPaletteSubFilterContribution)),
  paletteItemActions: Schema.OptionFromUndefinedOr(Schema.Array(EditorPaletteItemActionContribution)),
  viewportActions: Schema.OptionFromUndefinedOr(Schema.Array(EditorViewportActionContribution)),
  toolDock: Schema.OptionFromUndefinedOr(Schema.Array(EditorToolDockContribution)),
  overlays: Schema.OptionFromUndefinedOr(Schema.Array(EditorOverlayContribution)),
  inspectorPanels: Schema.OptionFromUndefinedOr(Schema.Array(EditorInspectorPanelContribution)),
  settingsPanels: Schema.OptionFromUndefinedOr(Schema.Array(EditorSettingsPanelContribution)),
  mapKinds: Schema.OptionFromUndefinedOr(Schema.Array(EditorMapKindContribution)),
  presets: Schema.OptionFromUndefinedOr(Schema.Array(EditorPresetContribution)),
  panels: Schema.OptionFromUndefinedOr(Schema.Array(EditorPanelContribution)),
  validators: Schema.OptionFromUndefinedOr(Schema.Array(EditorValidatorContribution)),
  exporters: Schema.OptionFromUndefinedOr(Schema.Array(EditorExporterContribution)),
  generators: Schema.OptionFromUndefinedOr(Schema.Array(EditorGeneratorContribution)),
  assetMetadata: Schema.OptionFromUndefinedOr(Schema.Array(EditorAssetMetadataContribution)),
  playerModelPolicies: Schema.OptionFromUndefinedOr(Schema.Array(EditorPlayerModelPolicyContribution)),
}) {}

export const RuntimeSystemContribution = defineExecutableContributionSlot("RuntimeSystem");
export type RuntimeSystemContribution = typeof RuntimeSystemContribution.Type;

export const RuntimeComponentContribution = defineDeclarativeContributionSlot("RuntimeComponent");
export type RuntimeComponentContribution = typeof RuntimeComponentContribution.Type;

export const RuntimeEventContribution = defineDeclarativeContributionSlot("RuntimeEvent");
export type RuntimeEventContribution = typeof RuntimeEventContribution.Type;

export const RuntimeAssetLoaderContribution = defineExecutableContributionSlot("RuntimeAssetLoader");
export type RuntimeAssetLoaderContribution = typeof RuntimeAssetLoaderContribution.Type;

export const RuntimeClientSystemContribution = defineExecutableContributionSlot("RuntimeClientSystem");
export type RuntimeClientSystemContribution = typeof RuntimeClientSystemContribution.Type;

export const RuntimeHudWidgetContribution = defineExecutableContributionSlot("RuntimeHudWidget");
export type RuntimeHudWidgetContribution = typeof RuntimeHudWidgetContribution.Type;

export const RuntimeLobbyPanelContribution = defineExecutableContributionSlot("RuntimeLobbyPanel");
export type RuntimeLobbyPanelContribution = typeof RuntimeLobbyPanelContribution.Type;

/**
 * Named menu slots in the generic game-client shell (ADR-0022). Plugins and
 * brands target these brand-neutral ids; the `@tileborne/game-client` shell
 * renders contributed sections into the matching slot. Keep this list the
 * single source of truth for menu slot ids.
 */
export const RuntimeMenuSlot = Schema.Literals([
  "main.primaryActions",
  "main.secondaryActions",
  "main.tabs",
  "settings.tabs",
  "pause.actions",
  "results.actions",
]);
export type RuntimeMenuSlot = typeof RuntimeMenuSlot.Type;

/** All menu slot ids as a readonly tuple (for iteration/validation). */
export const RUNTIME_MENU_SLOTS = RuntimeMenuSlot.literals;

/**
 * A plugin-contributed menu section mounted into a named menu slot of the
 * generic shell. Executable (ships React per ADR-0004 for the shipped runtime
 * client, distinct from the editor's declarative-only rule). Mirrors the
 * `RuntimeLobbyPanelContribution` precedent but adds a `slot` + `order`.
 */
export class RuntimeMenuSectionContribution extends Schema.TaggedClass<RuntimeMenuSectionContribution>()(
  "RuntimeMenuSectionContribution",
  {
    id: ContributionId,
    kind: ExecutableKind,
    slot: RuntimeMenuSlot,
    display: Schema.OptionFromUndefinedOr(ContributionDisplay),
    entry: Schema.String,
    order: Schema.OptionFromUndefinedOr(Schema.Number),
  },
) {}

export const RuntimeInputMapContribution = defineDeclarativeContributionSlot("RuntimeInputMap");
export type RuntimeInputMapContribution = typeof RuntimeInputMapContribution.Type;

export const RuntimeAudioBusContribution = defineDeclarativeContributionSlot("RuntimeAudioBus");
export type RuntimeAudioBusContribution = typeof RuntimeAudioBusContribution.Type;

export const RuntimeCameraContribution = defineExecutableContributionSlot("RuntimeCamera");
export type RuntimeCameraContribution = typeof RuntimeCameraContribution.Type;

export const RuntimeInterpolatorContribution = defineExecutableContributionSlot("RuntimeInterpolator");
export type RuntimeInterpolatorContribution = typeof RuntimeInterpolatorContribution.Type;

export const RuntimeErrorMapperContribution = defineDeclarativeContributionSlot("RuntimeErrorMapper");
export type RuntimeErrorMapperContribution = typeof RuntimeErrorMapperContribution.Type;

/**
 * Public declarative slot for a plugin to register a game-object catalog content
 * pack (ADR-0019). `data` is a `@tileborne/core` `GameObjectCatalog` (or an
 * `{ indexPath }` pointing at one) which the catalog registry decodes, validates
 * against the core schema, and merges with duplicate detection. Supersedes the
 * removed JSON-Schema `ObjectKindContribution` / `EditorObjectType` path.
 */
export const RuntimeGameObjectCatalogContribution = defineDeclarativeContributionSlot(
  "RuntimeGameObjectCatalog",
);
export type RuntimeGameObjectCatalogContribution =
  typeof RuntimeGameObjectCatalogContribution.Type;

/**
 * Public declarative slot for a plugin to register a neutral weapon-content pack
 * (ADR-0018 Slice 5). `data` is decoded + validated against the
 * `@tileborne/simulation` schemas (`WeaponDefinition` + `DamageDelivery` family,
 * with status-effect ids) by {@link decodeWeaponCatalog} / {@link mergeWeaponCatalogs}
 * in `weapon-catalog-registry.ts`: the engine owns the *shape*, plugins supply the
 * balance *numbers*. Mirrors {@link RuntimeGameObjectCatalogContribution} and
 * supersedes the removed untyped `JsonObject` weapon-catalog path.
 * Ability/status *definition* catalogs are deferred to P1 (`t-p1-status-abilities-plan`),
 * where their `@tileborne/simulation` schemas land.
 */
export const RuntimeWeaponCatalogContribution = defineDeclarativeContributionSlot(
  "RuntimeWeaponCatalog",
);
export type RuntimeWeaponCatalogContribution = typeof RuntimeWeaponCatalogContribution.Type;

export class RuntimeContributions extends Schema.Class<RuntimeContributions>("RuntimeContributions")({
  systems: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeSystemContribution)),
  components: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeComponentContribution)),
  events: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeEventContribution)),
  assetLoaders: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeAssetLoaderContribution)),
  clientSystems: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeClientSystemContribution)),
  hudWidgets: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeHudWidgetContribution)),
  lobbyPanels: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeLobbyPanelContribution)),
  menuSections: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeMenuSectionContribution)),
  inputMaps: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeInputMapContribution)),
  audioBuses: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeAudioBusContribution)),
  cameras: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeCameraContribution)),
  interpolators: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeInterpolatorContribution)),
  assetPacks: Schema.OptionFromUndefinedOr(Schema.Array(AssetPackContribution)),
  errorMappers: Schema.OptionFromUndefinedOr(Schema.Array(RuntimeErrorMapperContribution)),
  gameObjectCatalogs: Schema.OptionFromUndefinedOr(
    Schema.Array(RuntimeGameObjectCatalogContribution),
  ),
  weaponCatalogs: Schema.OptionFromUndefinedOr(
    Schema.Array(RuntimeWeaponCatalogContribution),
  ),
}) {}

export const ServerRuleContribution = defineHybridContributionSlot("ServerRule");
export type ServerRuleContribution = typeof ServerRuleContribution.Type;

export const ServerScoringContribution = defineHybridContributionSlot("ServerScoring");
export type ServerScoringContribution = typeof ServerScoringContribution.Type;

export const ServerLootTableContribution = defineDeclarativeContributionSlot("ServerLootTable");
export type ServerLootTableContribution = typeof ServerLootTableContribution.Type;

export const ServerMatchmakingContribution = defineHybridContributionSlot("ServerMatchmaking");
export type ServerMatchmakingContribution = typeof ServerMatchmakingContribution.Type;

export const ServerSystemContribution = defineExecutableContributionSlot("ServerSystem");
export type ServerSystemContribution = typeof ServerSystemContribution.Type;

export const ServerRoomRuleContribution = defineDeclarativeContributionSlot("ServerRoomRule");
export type ServerRoomRuleContribution = typeof ServerRoomRuleContribution.Type;

export const ServerMapValidatorContribution = defineExecutableContributionSlot("ServerMapValidator");
export type ServerMapValidatorContribution = typeof ServerMapValidatorContribution.Type;

export const ServerMatchPhaseContribution = defineHybridContributionSlot("ServerMatchPhase");
export type ServerMatchPhaseContribution = typeof ServerMatchPhaseContribution.Type;

export const ServerReplayWriterContribution = defineExecutableContributionSlot("ServerReplayWriter");
export type ServerReplayWriterContribution = typeof ServerReplayWriterContribution.Type;

export class ServerContributions extends Schema.Class<ServerContributions>("ServerContributions")({
  rules: Schema.OptionFromUndefinedOr(Schema.Array(ServerRuleContribution)),
  scoring: Schema.OptionFromUndefinedOr(Schema.Array(ServerScoringContribution)),
  lootTables: Schema.OptionFromUndefinedOr(Schema.Array(ServerLootTableContribution)),
  matchmaking: Schema.OptionFromUndefinedOr(Schema.Array(ServerMatchmakingContribution)),
  serverSystems: Schema.OptionFromUndefinedOr(Schema.Array(ServerSystemContribution)),
  roomRules: Schema.OptionFromUndefinedOr(Schema.Array(ServerRoomRuleContribution)),
  mapValidators: Schema.OptionFromUndefinedOr(Schema.Array(ServerMapValidatorContribution)),
  matchPhases: Schema.OptionFromUndefinedOr(Schema.Array(ServerMatchPhaseContribution)),
  replayWriters: Schema.OptionFromUndefinedOr(Schema.Array(ServerReplayWriterContribution)),
}) {}

export const SchemaVersion = Schema.Int;
export type SchemaVersion = typeof SchemaVersion.Type;

export class InlineSchemaMigrationChain extends Schema.TaggedClass<InlineSchemaMigrationChain>()(
  "InlineSchemaMigrationChain",
  {
    kind: Schema.Literal("inline"),
    latestVersion: SchemaVersion,
    chain: Schema.Unknown,
  },
) {}

export interface InlineSchemaMigrationChainEntry {
  readonly kind: "inline";
  readonly latestVersion: SchemaVersion;
  readonly chain: SchemaMigrationChain<unknown>;
}

export class ExecutableSchemaMigrationChain extends Schema.TaggedClass<ExecutableSchemaMigrationChain>()("ExecutableSchemaMigrationChain", {
  kind: Schema.Literal("executable"),
  latestVersion: SchemaVersion,
  chainEntry: Schema.String,
}) {}

export const SchemaMigrationEntry = Schema.Union([
  InlineSchemaMigrationChain,
  ExecutableSchemaMigrationChain,
]);
export type SchemaMigrationEntry = InlineSchemaMigrationChainEntry | ExecutableSchemaMigrationChain;

export class MigrationsTable extends Schema.Class<MigrationsTable>("MigrationsTable")({
  entries: Schema.Record(Schema.String, SchemaMigrationEntry),
}) {}

export class PluginContributions extends Schema.Class<PluginContributions>("PluginContributions")({
  panels: Schema.OptionFromUndefinedOr(Schema.Array(PluginPanelContribution)),
  tools: Schema.OptionFromUndefinedOr(Schema.Array(PluginToolContribution)),
  assetPacks: Schema.OptionFromUndefinedOr(Schema.Array(AssetPackContribution)),
  tilesetPacks: Schema.OptionFromUndefinedOr(Schema.Array(TilesetPackContribution)),
  tiledImportProfiles: Schema.optional(Schema.Array(TiledImportProfileContribution)),
  editor: Schema.OptionFromUndefinedOr(EditorContributions),
  runtime: Schema.OptionFromUndefinedOr(RuntimeContributions),
  server: Schema.OptionFromUndefinedOr(ServerContributions),
}) {}

const optionalArray = <A>(value: Option.Option<readonly A[]> | readonly A[] | undefined): readonly A[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined) {
    return [];
  }
  const option = value as Option.Option<readonly A[]>;
  return Option.isSome(option) ? option.value : [];
};

const assertUniqueContributionIds = (
  pluginId: PluginId,
  contributionPoint: string,
  contributions: readonly { readonly id: ContributionId }[],
): void => {
  const seen = new Set<string>();
  for (const contribution of contributions) {
    if (seen.has(contribution.id)) {
      throw new DuplicateContributionError({
        pluginId,
        contributionId: contribution.id,
        message: `duplicate ${contributionPoint} contribution id: ${contribution.id}`,
      });
    }
    seen.add(contribution.id);
  }
};

export const validatePluginContributions = (
  pluginId: PluginId,
  contributions: PluginContributions,
): void => {
  assertUniqueContributionIds(pluginId, "panel", optionalArray(contributions.panels));
  assertUniqueContributionIds(pluginId, "tool", optionalArray(contributions.tools));
  assertUniqueContributionIds(
    pluginId,
    "tiled import profile",
    optionalArray(contributions.tiledImportProfiles),
  );
};
