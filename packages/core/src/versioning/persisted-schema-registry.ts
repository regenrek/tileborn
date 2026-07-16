/**
 * Canonical inventory of every first-party JSON format that survives a process
 * restart or is shipped to another process. Domain packages still own their
 * codecs and migration functions; this registry owns the current version and
 * the release compatibility claim for those formats.
 *
 * Adding a persisted format without registering it here makes the format
 * unsupported for a production release. Changing a version requires updating
 * the owning codec/migration boundary and this registry in the same commit.
 */

export const PERSISTED_SCHEMA_VERSIONS = {
  projectManifest: 1,
  tileborneMap: 1,
  projectContent: 1,
  gameObjectCatalog: 1,
  weaponCatalog: 1,
  behaviorDefinition: 1,
  behaviorManifest: 1,
  behaviorRegistryCatalog: 1,
  projectBehaviorRegistry: 1,
  projectBehaviorTransaction: 2,
  projectIntegrityLock: 1,
  projectRevisionJournal: 1,
  projectRevisionOwner: 1,
  projectImportRecords: 1,
  tileborneConfig: 1,
  brandConfig: 1,
  workingPaletteStore: 1,
  projectRegistry: 1,
  projectAssetIndex: 1,
  tilesetManifest: 1,
  assetPackIntegrityLock: 1,
  assetLibraryIndex: 1,
  editorTilesetIndex: 1,
  tilePaletteMetadata: 1,
  pluginManifest: 1,
  pluginInstallLock: 1,
  pluginArchiveSidecar: 1,
  documentRecovery: 1,
  thumbnailCache: 1,
  runtimeMapPackage: 4,
  runtimeBehaviorPackage: 1,
  runtimeProjectContent: 1,
  roomStorage: 3,
  bundledGameManifest: 1,
  userInputOverlay: 1,
  lobbyReconnect: 1,
  userHudOverlay: 1,
  editorUiStore: 0,
} as const;

export type VersionedPersistedSchemaId = keyof typeof PERSISTED_SCHEMA_VERSIONS;

export type PersistedSchemaDurability =
  | 'authoring-source'
  | 'recovery-state'
  | 'server-state'
  | 'user-preference'
  | 'replaceable-derived'
  | 'shipped-artifact';

export type PersistedSchemaVersionLocation =
  | 'payload'
  | 'storage-key'
  | 'cache-path'
  | 'container'
  | 'unversioned';

export type OlderVersionPolicy = 'migrate' | 'refuse' | 'rebuild' | 'reset' | 'not-applicable';
export type InvalidVersionPolicy = 'refuse' | 'restore-or-refuse' | 'rebuild' | 'reset';

export interface PersistedSchemaCompatibility {
  /** Exact versions accepted by the current reader before/while migrating. */
  readonly readableVersions: readonly number[];
  readonly older: OlderVersionPolicy;
  readonly future: InvalidVersionPolicy;
  readonly corrupt: InvalidVersionPolicy;
}

export interface PersistedSchemaRegistration {
  readonly id: string;
  readonly currentVersion: number | null;
  readonly versionLocation: PersistedSchemaVersionLocation;
  readonly durability: PersistedSchemaDurability;
  readonly storage: string;
  readonly codecOwner: string;
  readonly migrationOwner: string;
  readonly compatibility: PersistedSchemaCompatibility;
  readonly note?: string;
}

type RegistrationInput = Omit<PersistedSchemaRegistration, 'id'>;

const versioned = (
  id: VersionedPersistedSchemaId,
  input: Omit<RegistrationInput, 'currentVersion'>,
): PersistedSchemaRegistration => ({
  id,
  currentVersion: PERSISTED_SCHEMA_VERSIONS[id],
  ...input,
});

const strictCurrent = (version: number): PersistedSchemaCompatibility => ({
  readableVersions: [version],
  older: 'refuse',
  future: 'refuse',
  corrupt: 'refuse',
});

const rebuildable = (version: number): PersistedSchemaCompatibility => ({
  readableVersions: [version],
  older: 'rebuild',
  future: 'rebuild',
  corrupt: 'rebuild',
});

const resettable = (version: number): PersistedSchemaCompatibility => ({
  readableVersions: [version],
  older: 'reset',
  future: 'reset',
  corrupt: 'reset',
});

/**
 * Compatibility matrix used by release tests and migration work. The order is
 * intentional: authoring sources, recovery state, derived state, shipped
 * formats, then process/user-local state.
 */
export const PERSISTED_SCHEMA_REGISTRY: readonly PersistedSchemaRegistration[] = [
  versioned('projectManifest', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<project>/project.json',
    codecOwner: 'packages/core/src/project/index.ts#ProjectManifest',
    migrationOwner: 'packages/services-app/src/project/index.ts#projectMigrationChain',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.projectManifest),
  }),
  versioned('tileborneMap', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<project>/maps/*.json',
    codecOwner: 'packages/core/src/map/index.ts#TileborneMap',
    migrationOwner: 'packages/core/src/map/decode.ts#decodePersistedTileborneMapJson',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.tileborneMap),
    note: 'The current reader also applies the idempotent legacy MapObject.kind shape migration within v1.',
  }),
  versioned('projectContent', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<project>/content/project-content.json',
    codecOwner: 'packages/plugin-api/src/project-content.ts#ProjectContentDocument',
    migrationOwner: 'packages/plugin-api/src/project-content.ts#decodeProjectContentDocument',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.projectContent),
    note: 'The current reader converts the legacy bare GameObjectCatalog shape into the v1 document.',
  }),
  versioned('gameObjectCatalog', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: 'plugin schemas/game-object-catalog.json and embedded project content',
    codecOwner: 'packages/core/src/catalog/object-type.ts#GameObjectCatalog',
    migrationOwner: 'packages/plugin-api/src/project-content.ts#decodeProjectContentDocument',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.gameObjectCatalog),
  }),
  versioned('weaponCatalog', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: 'plugin contributions and embedded project content',
    codecOwner: 'packages/plugin-api/src/weapon-catalog-registry.ts#WeaponCatalog',
    migrationOwner: 'packages/plugin-api/src/weapon-catalog-registry.ts',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.weaponCatalog),
  }),
  versioned('behaviorDefinition', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<project>/behaviors/visual/*.json',
    codecOwner: 'packages/core/src/behavior/index.ts#BehaviorDefinition',
    migrationOwner: 'packages/core/src/behavior/index.ts#migrateBehaviorDefinitionJson',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.behaviorDefinition),
  }),
  versioned('behaviorManifest', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<project>/behaviors/registry.json entries',
    codecOwner: 'packages/core/src/behavior/index.ts#BehaviorManifest',
    migrationOwner: 'packages/services-app/src/behavior/index.ts#decodeRegistryDocument',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.behaviorManifest),
  }),
  versioned('behaviorRegistryCatalog', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: 'engine/plugin behavior registry contributions',
    codecOwner: 'packages/core/src/behavior/index.ts#BehaviorRegistryManifest',
    migrationOwner: 'packages/core/src/behavior/index.ts',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.behaviorRegistryCatalog),
  }),
  versioned('projectBehaviorRegistry', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<project>/behaviors/registry.json',
    codecOwner: 'packages/services-app/src/behavior/index.ts#ProjectBehaviorRegistryDocument',
    migrationOwner: 'packages/services-app/src/behavior/index.ts#decodeRegistryDocument',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.projectBehaviorRegistry),
  }),
  versioned('projectImportRecords', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<project>/.tileborne/import-records.json',
    codecOwner: 'packages/services-app/src/project/index.ts#appendProjectImportRecord',
    migrationOwner: 'packages/services-app/src/project/index.ts#appendProjectImportRecord',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.projectImportRecords),
  }),
  versioned('tileborneConfig', {
    versionLocation: 'payload',
    durability: 'user-preference',
    storage: '<home>/config.json',
    codecOwner: 'packages/services-foundation/src/config/index.ts#TileborneConfig',
    migrationOwner: 'packages/services-foundation/src/config/index.ts#readConfigFile',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.tileborneConfig),
    note: 'The foundation-local codec constant is compared to this registry by the repository audit.',
  }),
  versioned('brandConfig', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<game>/branding/tokens.json',
    codecOwner: 'packages/core/src/branding/index.ts#BrandConfig',
    migrationOwner: 'packages/core/src/branding/index.ts#decodeBrandConfig',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.brandConfig),
    note: 'The missing schemaVersion legacy shape remains readable; explicit non-v1 versions are refused.',
  }),
  versioned('workingPaletteStore', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<project>/.tileborne/working-palettes.json',
    codecOwner: 'packages/core/src/asset/library.ts#WorkingPaletteStore',
    migrationOwner: 'packages/services-app/src/asset-library/index.ts#readPaletteStore',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.workingPaletteStore),
  }),
  versioned('tilesetManifest', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<asset-pack>/tileborne-asset-pack.json',
    codecOwner: 'packages/sdk-tileset/src/manifest/schema-version.ts#TilesetManifest',
    migrationOwner: 'packages/sdk-tileset/src/manifest/parse.ts',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.tilesetManifest),
  }),
  versioned('pluginManifest', {
    versionLocation: 'payload',
    durability: 'authoring-source',
    storage: '<plugin>/tileborne-plugin.json',
    codecOwner: 'packages/plugin-api/src/manifest.ts#PluginManifest',
    migrationOwner: 'packages/services-plugin/src/manifest-version.ts#pluginManifestMigrationChain',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.pluginManifest),
  }),
  versioned('pluginInstallLock', {
    versionLocation: 'payload',
    durability: 'replaceable-derived',
    storage: '<installed-plugin>/lock.json',
    codecOwner: 'packages/services-plugin/src/filesystem.ts#writeInstalledLock',
    migrationOwner: 'packages/services-plugin/src/filesystem.ts#readInstalledLock',
    compatibility: rebuildable(PERSISTED_SCHEMA_VERSIONS.pluginInstallLock),
    note: 'The current reader validates only integrity; identity/version validation is a known gap.',
  }),
  versioned('pluginArchiveSidecar', {
    versionLocation: 'payload',
    durability: 'shipped-artifact',
    storage: '<plugin-archive>.meta.json',
    codecOwner: 'packages/services-plugin/src/scaffold.ts#packPluginDirectory',
    migrationOwner: 'packages/services-plugin/src/scaffold.ts#packPluginDirectory',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.pluginArchiveSidecar),
    note: 'Writer-owned sidecar; there is no runtime reader or migration path yet.',
  }),
  versioned('projectRevisionJournal', {
    versionLocation: 'payload',
    durability: 'recovery-state',
    storage: '<project>/.tileborne/project-revision-transaction.json',
    codecOwner: 'packages/services-app/src/internal/project-revision-transaction.ts#decodeJournal',
    migrationOwner:
      'packages/services-app/src/internal/project-revision-transaction.ts#recoverProjectRevisionTransaction',
    compatibility: {
      ...strictCurrent(PERSISTED_SCHEMA_VERSIONS.projectRevisionJournal),
      corrupt: 'restore-or-refuse',
    },
  }),
  versioned('projectRevisionOwner', {
    versionLocation: 'payload',
    durability: 'recovery-state',
    storage: '<project>/.tileborne/project-revision-owner/owner.json',
    codecOwner: 'packages/services-app/src/internal/project-revision-transaction.ts#decodeOwner',
    migrationOwner: 'packages/services-app/src/internal/project-revision-transaction.ts',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.projectRevisionOwner),
  }),
  versioned('projectBehaviorTransaction', {
    versionLocation: 'payload',
    durability: 'recovery-state',
    storage: '<project>/behaviors/.transaction.json',
    codecOwner: 'packages/services-app/src/behavior/index.ts#ProjectBehaviorTransactionJournal',
    migrationOwner: 'packages/services-app/src/behavior/index.ts#recoverTransaction',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.projectBehaviorTransaction),
  }),
  versioned('documentRecovery', {
    versionLocation: 'payload',
    durability: 'recovery-state',
    storage: 'localStorage tileborne:document-recovery:v1:*',
    codecOwner: 'apps/desktop/src/renderer/lib/document-lifecycle.ts#DocumentRecoveryRecord',
    migrationOwner: 'apps/desktop/src/renderer/lib/document-lifecycle.ts#readRecovery',
    compatibility: resettable(PERSISTED_SCHEMA_VERSIONS.documentRecovery),
  }),
  versioned('projectIntegrityLock', {
    versionLocation: 'payload',
    durability: 'replaceable-derived',
    storage: '<project>/project.lock.json',
    codecOwner: 'packages/services-app/src/internal/layout.ts#ProjectIntegrityLock',
    migrationOwner: 'packages/services-app/src/project/index.ts#writeProjectWithLock',
    compatibility: rebuildable(PERSISTED_SCHEMA_VERSIONS.projectIntegrityLock),
  }),
  versioned('projectRegistry', {
    versionLocation: 'payload',
    durability: 'replaceable-derived',
    storage: '<home>/projects/registry.json',
    codecOwner: 'packages/services-app/src/internal/project-registry.ts#ProjectRegistry',
    migrationOwner: 'packages/services-app/src/internal/project-registry.ts#readProjectRegistry',
    compatibility: rebuildable(PERSISTED_SCHEMA_VERSIONS.projectRegistry),
  }),
  versioned('projectAssetIndex', {
    versionLocation: 'payload',
    durability: 'replaceable-derived',
    storage: '<project>/.tileborne/derived/asset-index.json',
    codecOwner: 'packages/services-app/src/asset/index.ts#ProjectAssetIndex',
    migrationOwner: 'packages/services-app/src/asset/index.ts',
    compatibility: rebuildable(PERSISTED_SCHEMA_VERSIONS.projectAssetIndex),
  }),
  versioned('assetPackIntegrityLock', {
    versionLocation: 'payload',
    durability: 'replaceable-derived',
    storage: '<installed-asset-pack>/lock.json',
    codecOwner: 'packages/services-app/src/internal/layout.ts#AssetPackIntegrityLock',
    migrationOwner: 'packages/services-app/src/asset/index.ts',
    compatibility: rebuildable(PERSISTED_SCHEMA_VERSIONS.assetPackIntegrityLock),
  }),
  versioned('assetLibraryIndex', {
    versionLocation: 'payload',
    durability: 'replaceable-derived',
    storage: '<home>/cache/asset-library/indexes/*.json',
    codecOwner: 'packages/services-app/src/asset-library/index.ts#AssetLibraryIndexCacheFile',
    migrationOwner: 'packages/services-app/src/asset-library/index.ts',
    compatibility: rebuildable(PERSISTED_SCHEMA_VERSIONS.assetLibraryIndex),
  }),
  versioned('editorTilesetIndex', {
    versionLocation: 'payload',
    durability: 'replaceable-derived',
    storage: '<home>/cache/asset-library/editor-indexes/*.json',
    codecOwner: 'packages/sdk-tileset/src/editor-index/types.ts#EditorTilesetIndexJson',
    migrationOwner: 'packages/services-app/src/asset-library/index.ts',
    compatibility: rebuildable(PERSISTED_SCHEMA_VERSIONS.editorTilesetIndex),
  }),
  versioned('thumbnailCache', {
    versionLocation: 'cache-path',
    durability: 'replaceable-derived',
    storage: '<home>/cache/asset-library/thumbnails/vN-*',
    codecOwner: 'apps/desktop/src/main/asset-library/asset-protocol-url.ts',
    migrationOwner: 'apps/desktop/src/main/asset-library/thumbnail-generator.ts',
    compatibility: rebuildable(PERSISTED_SCHEMA_VERSIONS.thumbnailCache),
  }),
  versioned('tilePaletteMetadata', {
    versionLocation: 'payload',
    durability: 'replaceable-derived',
    storage: '<asset-pack>/metadata/tileborne-palette.json',
    codecOwner: 'apps/desktop/src/renderer/lib/tile-palette-metadata.ts#TilePaletteMetadata',
    migrationOwner:
      'apps/desktop/src/renderer/lib/tile-palette-metadata.ts#loadTilePaletteMetadata',
    compatibility: rebuildable(PERSISTED_SCHEMA_VERSIONS.tilePaletteMetadata),
  }),
  versioned('runtimeMapPackage', {
    versionLocation: 'payload',
    durability: 'shipped-artifact',
    storage: '<build>/maps/<map-id>/manifest.json plus package sections',
    codecOwner: 'packages/core/src/map-package/index.ts#RuntimeMapPackage',
    migrationOwner: 'packages/runtime/src/map-package/loader.ts',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.runtimeMapPackage),
    note: 'Release artifacts are rebuilt from authoring sources rather than migrated in place.',
  }),
  versioned('runtimeBehaviorPackage', {
    versionLocation: 'payload',
    durability: 'shipped-artifact',
    storage: '<runtime-map-package>/behaviors',
    codecOwner: 'packages/core/src/behavior/index.ts#RuntimeBehaviorPackage',
    migrationOwner: 'packages/runtime/src/map-package/loader.ts',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.runtimeBehaviorPackage),
  }),
  versioned('runtimeProjectContent', {
    versionLocation: 'payload',
    durability: 'shipped-artifact',
    storage: '<runtime-map-package>/content',
    codecOwner: 'packages/plugin-api/src/project-content.ts#RuntimeProjectContent',
    migrationOwner: 'packages/runtime/src/map-package/loader.ts',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.runtimeProjectContent),
  }),
  versioned('roomStorage', {
    versionLocation: 'payload',
    durability: 'server-state',
    storage: 'Cloudflare Durable Object storage key state',
    codecOwner: 'apps/game-host/src/rooms/storage-schema.ts#RoomStorage',
    migrationOwner: 'apps/game-host/src/rooms/storage-schema.ts#migrateRoomStorage',
    compatibility: {
      readableVersions: [1, 2, PERSISTED_SCHEMA_VERSIONS.roomStorage],
      older: 'migrate',
      future: 'refuse',
      corrupt: 'refuse',
    },
  }),
  versioned('bundledGameManifest', {
    versionLocation: 'payload',
    durability: 'shipped-artifact',
    storage: '<shipped-game>/manifest.json',
    codecOwner: 'apps/game-host/src/types.ts#BundledManifest',
    migrationOwner: 'apps/game-host/src/build/manifest.ts',
    compatibility: strictCurrent(PERSISTED_SCHEMA_VERSIONS.bundledGameManifest),
    note: 'The interface is versioned but the shipped reader has no runtime decoder/version gate yet.',
  }),
  versioned('userInputOverlay', {
    versionLocation: 'storage-key',
    durability: 'user-preference',
    storage: 'localStorage tileborne:input:user-overlay:v1',
    codecOwner: 'packages/core/src/input/input-map.ts#InputMap',
    migrationOwner:
      'packages/game-client/src/input/user-bindings.ts#createLocalStorageBindingsStore',
    compatibility: resettable(PERSISTED_SCHEMA_VERSIONS.userInputOverlay),
    note: 'The game-client store is canonical; the desktop playtest adapter delegates to it.',
  }),
  versioned('lobbyReconnect', {
    versionLocation: 'storage-key',
    durability: 'user-preference',
    storage: 'localStorage tileborne.game-client.lobby-reconnect.v1',
    codecOwner: 'apps/game-client/src/app.tsx#StoredLobbyReconnect',
    migrationOwner: 'apps/game-client/src/app.tsx#readStoredLobbyReconnect',
    compatibility: resettable(PERSISTED_SCHEMA_VERSIONS.lobbyReconnect),
  }),
  versioned('userHudOverlay', {
    versionLocation: 'storage-key',
    durability: 'user-preference',
    storage: 'localStorage tileborne:hud:user-overlay:v1',
    codecOwner: 'packages/core/src/hud/hud-layout.ts#HudLayout',
    migrationOwner: 'apps/desktop/src/renderer/lib/playtest-user-hud.ts',
    compatibility: resettable(PERSISTED_SCHEMA_VERSIONS.userHudOverlay),
  }),
  {
    id: 'genericAssetPackManifest',
    currentVersion: null,
    versionLocation: 'unversioned',
    durability: 'authoring-source',
    storage: '<asset-pack>/tileborne-asset-pack.json (generic pack shape)',
    codecOwner: 'packages/asset-pipeline/src/pack/pack-manifest.ts#AssetPackManifest',
    migrationOwner: 'packages/services-app/src/asset/index.ts',
    compatibility: {
      readableVersions: [],
      older: 'not-applicable',
      future: 'refuse',
      corrupt: 'refuse',
    },
    note: 'Known 1.0 gap: the generic pack codec has no schemaVersion while the tileset extension is v1.',
  },
  versioned('editorUiStore', {
    versionLocation: 'container',
    durability: 'user-preference',
    storage: 'localStorage tileborne-editor-ui (Zustand persist container)',
    codecOwner: 'apps/desktop/src/renderer/stores/editor-ui-store.ts',
    migrationOwner: 'apps/desktop/src/renderer/stores/editor-ui-store.ts',
    compatibility: resettable(PERSISTED_SCHEMA_VERSIONS.editorUiStore),
    note: 'Zustand defaults the container version to 0; no explicit migration exists.',
  }),
  {
    id: 'lobbyModelSelection',
    currentVersion: null,
    versionLocation: 'unversioned',
    durability: 'user-preference',
    storage: 'localStorage tileborne.playerModel.selection.<project-id>',
    codecOwner: 'apps/desktop/src/renderer/lib/lobby-model-selection.ts',
    migrationOwner: 'apps/desktop/src/renderer/lib/lobby-model-selection.ts',
    compatibility: {
      readableVersions: [],
      older: 'not-applicable',
      future: 'reset',
      corrupt: 'reset',
    },
    note: 'Known 1.0 gap: the raw string preference has no explicit version marker.',
  },
  {
    id: 'battleRoyaleLoadoutSelection',
    currentVersion: null,
    versionLocation: 'unversioned',
    durability: 'user-preference',
    storage: 'localStorage tileborne.battle-royale.loadout.model',
    codecOwner: 'packages/plugin-battle-royale/src/player-models/loadout.ts#readSelectedModelId',
    migrationOwner:
      'packages/plugin-battle-royale/src/player-models/loadout.ts#writeSelectedModelId',
    compatibility: {
      readableVersions: [],
      older: 'not-applicable',
      future: 'reset',
      corrupt: 'reset',
    },
    note: 'Known 1.0 gap: the raw string preference has no explicit version marker.',
  },
  {
    id: 'persistentJobRecord',
    currentVersion: null,
    versionLocation: 'unversioned',
    durability: 'recovery-state',
    storage: '<home>/cache/jobs/*.json',
    codecOwner: 'packages/services-foundation/src/job/index.ts#PersistedJobState',
    migrationOwner: 'packages/services-foundation/src/job/index.ts#decodePersistedState',
    compatibility: {
      readableVersions: [],
      older: 'not-applicable',
      future: 'reset',
      corrupt: 'reset',
    },
    note: 'Known 1.0 gap: operational job recovery records are unversioned; invalid records are ignored.',
  },
  {
    id: 'thinGameProjectConfig',
    currentVersion: null,
    versionLocation: 'unversioned',
    durability: 'authoring-source',
    storage: '<thin-game-product>/tileborne.config.json',
    codecOwner: 'packages/cli/src/commands/game/init-templates.ts#renderTileborneConfig',
    migrationOwner: 'packages/cli/src/commands/game/init-templates.ts#renderTileborneConfig',
    compatibility: {
      readableVersions: [],
      older: 'not-applicable',
      future: 'refuse',
      corrupt: 'refuse',
    },
    note: 'Known 1.0 gap: the generated thin-game build config has no schemaVersion or shared decoder.',
  },
  {
    id: 'buildAndExportArtifactMetadata',
    currentVersion: null,
    versionLocation: 'unversioned',
    durability: 'shipped-artifact',
    storage: '<home>/builds/*/manifest.json and <home>/exports/*/manifest.json',
    codecOwner: 'packages/services-build/src/model.ts',
    migrationOwner: 'packages/services-build/src/internal/persistence.ts',
    compatibility: {
      readableVersions: [],
      older: 'not-applicable',
      future: 'refuse',
      corrupt: 'refuse',
    },
    note: 'Known 1.0 gap: integrity-protected artifact metadata is not schema-versioned.',
  },
] as const;

export const persistedSchemaRegistration = (id: string): PersistedSchemaRegistration | undefined =>
  PERSISTED_SCHEMA_REGISTRY.find((registration) => registration.id === id);
