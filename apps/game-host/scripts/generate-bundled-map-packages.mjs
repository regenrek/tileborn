import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';

/**
 * Generate the dev/test `bundled-map-packages` module from the REAL sources
 * instead of hand-baked data (ADR-0030): the BR plugin's shipped game-object
 * catalog, the real `exportBattleRoyaleModeData` exporter, the plugin's
 * default player models, and a small authored 64x64 dev arena map. The
 * assembled wire JSON is validated against the `RuntimeMapPackage` schema
 * before the TS module is written.
 *
 * `tileborne game build --target cloudflare` overrides this module in its
 * staging dir with the packages assembled from the selected project/maps
 * (M5 S1); this script only feeds the dev/test worker bundle.
 *
 * Requires the `@tileborne/core`, `@tileborne/runtime`, and
 * `@tileborne/plugin-battle-royale` dists to be built (same precondition as
 * the bundled plugin runtime).
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gameHostRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(gameHostRoot, '../..');
const generatedDir = path.join(gameHostRoot, 'src/.generated');

const CATALOG_PATH = path.join(
  repoRoot,
  'packages/plugin-battle-royale/schemas/game-object-catalog.json',
);

const MAP_ID = 'map:ca95c595-fa38-4c5e-bfea-39ad975b8091';
const OBJECT_LAYER_ID = 'layer:a28be6c1-5827-40aa-ab9e-9f23f140f737';
const MAP_SIZE_TILES = 64;
const TILE_SIZE_PX = 32;
const MAX_PLAYERS = 32;

/** Deterministic `object:` ids so regeneration is byte-stable. */
const objectId = (index) => `object:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const DEFAULT_PACKAGE_ID = 'mappkg:550e8400-e29b-41d4-a716-446655440777';

export const generateBundledMapPackages = async () => {
  const [core, plugin, runtimeMapPackage] = await Promise.all([
    import('@tileborne/core'),
    import('@tileborne/plugin-battle-royale'),
    import('@tileborne/runtime/map-package'),
  ]);
  const { Result, Schema } = await import('effect');
  const { hashRuntimeMapPackageEntry } = runtimeMapPackage;

  const catalogJson = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  const shippedCatalog = Schema.decodeUnknownSync(core.GameObjectCatalog)(catalogJson);
  const pluginId = Schema.decodeUnknownSync(core.PluginId)(plugin.PLUGIN_ID);
  const catalog = shippedCatalog.objectTypes.map(
    (objectType) =>
      new core.RuntimeCatalogEntry({ origin: { _tag: 'plugin', pluginId }, objectType }),
  );

  // A small authored dev arena: an 8x4 spawn grid (32 spawn points, all
  // within the 64-tile map bounds) plus one shrink-zone anchor at the center.
  const spawnObjects = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      spawnObjects.push({
        id: objectId(spawnObjects.length + 1),
        kind: plugin.SPAWN_POINT_KIND,
        x: 4 + column * 8,
        y: 12 + row * 12,
        layerId: OBJECT_LAYER_ID,
        properties: {},
      });
    }
  }
  const anchorObject = {
    id: objectId(spawnObjects.length + 1),
    kind: plugin.SHRINK_ZONE_ANCHOR_KIND,
    x: MAP_SIZE_TILES / 2,
    y: MAP_SIZE_TILES / 2,
    layerId: OBJECT_LAYER_ID,
    properties: { initialRadiusTiles: 24 },
  };
  const objects = [...spawnObjects, anchorObject];

  const map = Schema.decodeUnknownSync(core.TileborneMap)({
    id: MAP_ID,
    schemaVersion: 1,
    size: { width: MAP_SIZE_TILES, height: MAP_SIZE_TILES },
    tileSize: { width: TILE_SIZE_PX, height: TILE_SIZE_PX },
    layers: [
      {
        kind: 'object',
        id: OBJECT_LAYER_ID,
        name: 'entities',
        visible: true,
        opacity: 1,
        objectIds: objects.map((object) => object.id),
      },
    ],
    objects,
    // BR settings live in the plugin-namespaced section the exporter reads
    // canonically (ADR-0023 §A) — never as legacy flat map properties.
    properties: { [plugin.PLUGIN_ID]: { maxPlayers: MAX_PLAYERS } },
  });

  // The same role-free projection assembly performs (`map.objects` → placements).
  const placements = map.objects.map(
    (object) =>
      new core.RuntimeObjectPlacement({
        objectId: object.id,
        typeId: object.kind,
        x: object.x,
        y: object.y,
        ...(Object.keys(object.properties).length > 0
          ? { instanceProperties: object.properties }
          : {}),
      }),
  );
  const settings = { [plugin.PLUGIN_ID]: { maxPlayers: MAX_PLAYERS } };

  const objectTypes = catalog.map((entry) => entry.objectType);
  const visuals = new core.RuntimeMapPackageVisuals({
    playerModels: plugin.DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS,
    overlayVisuals: core.deriveOverlayVisuals(objectTypes, {}).visuals,
    weaponVisuals: core.deriveWeaponVisuals(objectTypes).visuals,
  });

  const modeData = {
    [plugin.PLUGIN_ID]: Result.getOrThrow(
      plugin.exportBattleRoyaleModeData({
        map,
        catalog,
        placements,
        settings: settings[plugin.PLUGIN_ID],
      }),
    ),
  };

  const sections = {
    map: Schema.encodeSync(core.TileborneMap)(map),
    catalog: Schema.encodeSync(Schema.Array(core.RuntimeCatalogEntry))(catalog),
    placements: Schema.encodeSync(Schema.Array(core.RuntimeObjectPlacement))(placements),
    settings,
    // The dev package has no project-owned definitions, but v3 requires the
    // first-class neutral section so it exercises the same loader contract as
    // playtest and shipped project packages.
    content: {
      schemaVersion: 1,
      items: [],
      lootTables: [],
      weapons: [],
      provenance: {},
    },
    behaviors: Schema.encodeSync(core.RuntimeBehaviorPackage)(core.EMPTY_RUNTIME_BEHAVIOR_PACKAGE),
    audio: {
      schemaVersion: 1,
      buses: [],
      cues: [],
      diagnostics: [],
      settings: {
        masterVolume: 1,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: {},
      },
    },
    visuals: Schema.encodeSync(core.RuntimeMapPackageVisuals)(visuals),
    assets: [],
    modeData,
  };

  // Real per-section content hashes (M2 review, N2): no generated package
  // ships `entryHashes: {}`. Hashed over each section's JSON encoding.
  const entryHashes = {};
  for (const [entryName, section] of Object.entries(sections)) {
    entryHashes[entryName] = await hashRuntimeMapPackageEntry(
      new TextEncoder().encode(JSON.stringify(section)),
    );
  }

  const wire = {
    manifest: {
      packageId: DEFAULT_PACKAGE_ID,
      schemaVersion: core.RUNTIME_MAP_PACKAGE_SCHEMA_VERSION,
      projectId: 'project:550e8400-e29b-41d4-a716-446655440888',
      mapId: MAP_ID,
      activeMode: plugin.PLUGIN_ID,
      // Neutral capacity from the authored settings (M2 review, F2).
      playerCapacity: MAX_PLAYERS,
      engineVersion: '0.0.0-dev',
      createdAt: '1970-01-01T00:00:00.000Z',
      entryHashes,
    },
    ...sections,
  };

  // Fail generation loudly if the assembled wire does not decode as a
  // RuntimeMapPackage after a JSON round-trip (the shape rooms receive).
  Schema.decodeUnknownSync(core.RuntimeMapPackage)(JSON.parse(JSON.stringify(wire)));
  for (const placement of placements) {
    if (
      placement.x < 0 ||
      placement.x > MAP_SIZE_TILES ||
      placement.y < 0 ||
      placement.y > MAP_SIZE_TILES
    ) {
      throw new Error(`default package placement out of map bounds: ${placement.objectId}`);
    }
  }

  const bundled = [
    {
      mapId: MAP_ID,
      packageId: DEFAULT_PACKAGE_ID,
      mapPackage: wire,
    },
  ];

  await mkdir(generatedDir, { recursive: true });
  await writeFile(
    path.join(generatedDir, 'bundled-map-packages.ts'),
    `/**
 * GENERATED by scripts/generate-bundled-map-packages.mjs — do not edit.
 *
 * Encoded \`RuntimeMapPackage\`s (ADR-0030) the dev/test worker boots
 * packageless rooms from: built from the BR plugin's shipped game-object
 * catalog, the real \`exportBattleRoyaleModeData\` output, the plugin's
 * default player models, and a small authored 64x64 dev arena map.
 * \`game build --target cloudflare\` replaces this module with the packages
 * assembled from the selected project/maps (M5 S1).
 */
import type { BundledMapPackage } from "../types.js";

export const bundledMapPackages: readonly BundledMapPackage[] = ${JSON.stringify(bundled, null, 2)} as unknown as readonly BundledMapPackage[];
`,
    'utf8',
  );

  return bundled;
};

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await generateBundledMapPackages();
}
