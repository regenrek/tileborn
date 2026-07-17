import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type GameObjectType,
  gameObjectTypeIdForKey,
  validateCatalog,
  validatePlayerModelRef,
} from '@tileborne/core';
import { decodeGameObjectCatalog } from '@tileborne/plugin-api';
import { parseTilesetManifest } from '@tileborne/sdk-tileset/manifest';
import { Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  BATTLE_ROYALE_CORE_PACK_ID,
  BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS,
  DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS,
} from './content-assets.js';
import {
  BARRIER_KEY,
  BR_OVERLAY_SLOTS,
  DECOY_KEY,
  LOOT_CRATE_KEY,
  SHRINK_ZONE_ANCHOR_KEY,
  SPAWN_POINT_KEY,
  TRAP_KEY,
} from './constants.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetIndexPath = path.join(packageRoot, 'assets/index.json');
const packRoot = path.join(packageRoot, 'assets/core');
const packManifestPath = path.join(packRoot, 'tileborne-asset-pack.json');
const catalogPath = path.join(packageRoot, 'schemas/game-object-catalog.json');

const sha256 = (bytes: Buffer): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const readJson = (filePath: string): unknown =>
  JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;

const decodeCatalog = () => {
  const decoded = decodeGameObjectCatalog('br-game-object-catalog', readJson(catalogPath));
  if (Result.isFailure(decoded)) {
    throw new Error(decoded.failure.message);
  }
  return decoded.success;
};

const visualRefs = (objectType: GameObjectType) =>
  objectType.components.filter((component) => component._tag === 'visual-ref');

describe('Battle Royale production content assets', () => {
  it('ships an installable OSS-safe generated pack with valid file integrity', () => {
    const metadata = JSON.stringify(readJson(assetIndexPath));
    expect(metadata).not.toMatch(/placeholder|binary deferred/i);
    expect(fs.existsSync(path.join(packRoot, 'atlases/players.png'))).toBe(false);

    const raw = readJson(packManifestPath);
    const parsed = parseTilesetManifest(raw);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.value?.id).toBe(BATTLE_ROYALE_CORE_PACK_ID);
    expect(parsed.value?.license.redistributable).toBe(true);
    expect(parsed.value?.placeables).toHaveLength(29);

    const manifest = raw as {
      readonly assets: readonly {
        readonly path: string;
        readonly size: number;
        readonly hash: string;
        readonly license: { readonly redistributable: boolean; readonly spdxId: string };
      }[];
    };
    for (const asset of manifest.assets) {
      const bytes = fs.readFileSync(path.join(packRoot, asset.path));
      expect(bytes.byteLength).toBe(asset.size);
      expect(sha256(bytes)).toBe(asset.hash);
      expect(asset.license).toMatchObject({ spdxId: 'MIT', redistributable: true });
    }
  });

  it('backs every default player model with required clips from the generated pack', () => {
    const pack = parseTilesetManifest(readJson(packManifestPath)).value;
    expect(pack).toBeDefined();
    const placeables = new Map(
      (pack?.placeables ?? []).map((placeable) => [String(placeable.id), placeable]),
    );

    expect(DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS.map((entry) => entry.id)).toEqual([
      'maltipoo-mae',
      'maltipoo-max',
    ]);
    for (const model of DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS) {
      expect(validatePlayerModelRef(model)).toEqual([]);
      expect(model.ref.packId).toBe(BATTLE_ROYALE_CORE_PACK_ID);
      const placeable = placeables.get(model.ref.refId);
      expect(placeable).toBeDefined();
      expect(placeable?.size).toEqual({ width: 192, height: 208 });
      const clipIds = new Set((placeable?.clips ?? []).map((clip) => String(clip.id)));
      expect(Object.values(model.clips).every((clipId) => clipIds.has(String(clipId)))).toBe(true);
      expect(placeable?.clips?.find((clip) => clip.name === 'shoot')?.frames[0]?.uv).toEqual({
        x: 0,
        y: 8 * 208,
        w: 192,
        h: 208,
      });
    }
  });

  it('documents Maltipoo clip mappings and QA provenance instead of shipping anonymous generated players', () => {
    const raw = readJson(packManifestPath) as {
      readonly provenance?: {
        readonly sourceAssets?: readonly {
          readonly modelId: string;
          readonly atlas: string;
          readonly contactSheet: string;
          readonly validation: string;
        }[];
      };
      readonly placeables: readonly {
        readonly name: string;
        readonly source?: {
          readonly image?: string;
          readonly properties?: {
            readonly assetFormat?: string;
            readonly contactSheetPath?: string;
            readonly validationPath?: string;
            readonly clipSourceRows?: Record<
              string,
              { readonly sourceState: string; readonly fallbackNote?: string }
            >;
          };
        };
      }[];
    };

    expect(raw.provenance?.sourceAssets?.map((entry) => entry.modelId)).toEqual([
      'maltipoo-mae',
      'maltipoo-max',
    ]);
    for (const source of raw.provenance?.sourceAssets ?? []) {
      expect(fs.existsSync(path.join(packRoot, source.atlas))).toBe(true);
      expect(fs.existsSync(path.join(packRoot, source.contactSheet))).toBe(true);
      expect(fs.existsSync(path.join(packRoot, source.validation))).toBe(true);
    }

    const playerPlaceables = raw.placeables.filter(
      (placeable) => placeable.source?.properties?.assetFormat === 'codex_pet',
    );
    expect(playerPlaceables.map((placeable) => placeable.name)).toEqual([
      'Maltipoo Mae',
      'Maltipoo Max',
    ]);
    for (const placeable of playerPlaceables) {
      expect(placeable.source?.image).toMatch(/^atlases\/player-models\/maltipoo-/);
      expect(placeable.source?.properties?.contactSheetPath).toMatch(/contact-sheet\.png$/);
      expect(placeable.source?.properties?.validationPath).toMatch(/validation\.json$/);
      expect(placeable.source?.properties?.clipSourceRows?.shoot).toMatchObject({
        sourceState: 'review',
        fallbackNote: expect.stringMatching(/weapon overlay/i),
      });
      expect(placeable.source?.properties?.clipSourceRows?.reload).toMatchObject({
        sourceState: 'waiting',
      });
    }
  });

  it('catalog visual refs, item refs, and object type ids resolve against shipped content', () => {
    const catalog = decodeCatalog();
    const pack = parseTilesetManifest(readJson(packManifestPath)).value;
    const assetIds = new Set((pack?.assets ?? []).map((asset) => String(asset.id)));
    const placeableIds = new Set((pack?.placeables ?? []).map((placeable) => String(placeable.id)));
    const validated = validateCatalog(catalog, {
      resolveAsset: (assetId) => assetIds.has(assetId),
    });

    expect(Result.isSuccess(validated)).toBe(true);
    expect(catalog.objectTypes.map((entry) => entry.label)).toEqual([
      'Spawn Point',
      'Shrink Zone Anchor',
      'Loot Crate',
      'Trap',
      'Decoy',
      'Barrier',
      // Weapon entity + companions (ADR-0028: weapon visuals as entities).
      'Pulse Carbine',
      'Projectile Bolt',
      'Muzzle Flash',
      'Impact Burst',
      // Overlay claimant entities (visual-role hard cut: entity-first).
      'Shield Bubble',
      'Player Shadow',
      'Hazard Flame',
    ]);
    expect(catalog.objectTypes.slice(0, 6).map((entry) => entry.id)).toEqual([
      gameObjectTypeIdForKey(SPAWN_POINT_KEY),
      gameObjectTypeIdForKey(SHRINK_ZONE_ANCHOR_KEY),
      gameObjectTypeIdForKey(LOOT_CRATE_KEY),
      gameObjectTypeIdForKey(TRAP_KEY),
      gameObjectTypeIdForKey(DECOY_KEY),
      gameObjectTypeIdForKey(BARRIER_KEY),
    ]);
    expect(catalog.objectTypes.slice(6).map((entry) => String(entry.id))).toEqual([
      gameObjectTypeIdForKey('weapon-pulse-carbine'),
      gameObjectTypeIdForKey('weapon-projectile-bolt'),
      gameObjectTypeIdForKey('weapon-muzzle-flash'),
      gameObjectTypeIdForKey('weapon-impact-burst'),
      gameObjectTypeIdForKey('shield-bubble'),
      gameObjectTypeIdForKey('player-shadow'),
      gameObjectTypeIdForKey('hazard-flame'),
    ]);
    for (const objectType of catalog.objectTypes) {
      expect(visualRefs(objectType)).toHaveLength(1);
      const visualRef = visualRefs(objectType)[0]!;
      expect(
        Option.isSome(visualRef.assetId) && assetIds.has(String(visualRef.assetId.value)),
      ).toBe(true);
      expect(
        Option.isSome(visualRef.placeableId) &&
          placeableIds.has(String(visualRef.placeableId.value)),
      ).toBe(true);
    }
    expect(Option.getOrElse(catalog.items, () => [])).toHaveLength(4);
  });

  it('ships overlay claimant entities backed by distinct core-pack object sprites', () => {
    const pack = parseTilesetManifest(readJson(packManifestPath)).value;
    const placeableIds = new Set((pack?.placeables ?? []).map((placeable) => String(placeable.id)));
    const visualPlaceableIds = [
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.lootCrate,
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.trap,
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.decoy,
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.barrier,
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.rifle,
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.projectileBolt,
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.muzzleFlash,
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.impactBurst,
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.shieldBubble,
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.playerShadow,
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.hazardFlame,
      ...Object.values(BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.petwarsWeapons),
    ];

    expect(visualPlaceableIds.every((id) => placeableIds.has(id))).toBe(true);

    // Overlay visuals are catalog ENTITIES claiming slots via `overlay-visual`
    // (visual-role hard cut) — one claimant per BR slot, each backed by a
    // distinct shipped placeable sprite.
    const catalog = decodeCatalog();
    const overlayEntities = catalog.objectTypes.flatMap((objectType) => {
      const overlay = objectType.components.find(
        (component) => component._tag === 'overlay-visual',
      );
      return overlay === undefined ? [] : [{ objectType, slot: String(overlay.slot) }];
    });

    expect(overlayEntities.map((entry) => entry.slot).sort()).toEqual(
      Object.values(BR_OVERLAY_SLOTS).sort(),
    );
    const overlayRefIds = overlayEntities.map((entry) => {
      const visualRef = visualRefs(entry.objectType)[0]!;
      expect(Option.isSome(visualRef.placeableId)).toBe(true);
      const refId = String(Option.getOrThrow(visualRef.placeableId));
      expect(placeableIds.has(refId)).toBe(true);
      return refId;
    });
    expect(new Set(overlayRefIds).size).toBe(overlayEntities.length);
  });

  it('imports Petwars weapon sprites as first-class working-palette placeables', () => {
    const raw = readJson(packManifestPath) as {
      readonly provenance?: {
        readonly petwarsWeapons?: readonly {
          readonly slug: string;
          readonly kind: string;
          readonly atlas: string;
        }[];
      };
      readonly placeables: readonly {
        readonly name: string;
        readonly size: { readonly width: number; readonly height: number };
        readonly tags?: readonly string[];
        readonly source?: {
          readonly image?: string;
          readonly properties?: {
            readonly sourceGame?: string;
            readonly weaponSlug?: string;
            readonly weaponKind?: string;
            readonly 'tileborne.visual.scale'?: number;
            readonly 'tileborne.visual.handX'?: number;
            readonly 'tileborne.visual.handY'?: number;
            readonly 'tileborne.visual.muzzleX'?: number;
            readonly 'tileborne.visual.muzzleY'?: number;
          };
        };
      }[];
    };
    const petwarsPlaceables = raw.placeables.filter((placeable) =>
      placeable.tags?.includes('petwars'),
    );

    expect(raw.provenance?.petwarsWeapons?.map((weapon) => weapon.slug)).toEqual([
      'ion-blaster',
      'pulse-ranger',
      'arc-burst',
      'pulse-carbine',
      'scatter-lance',
      'arc-charger',
      'ricochet-disc',
      'rail-needle',
      'nova-launcher',
      'prism-beam',
      'plasma-sabre',
    ]);
    expect(petwarsPlaceables.map((placeable) => placeable.name)).toEqual([
      'Ion Blaster',
      'Pulse Ranger',
      'Arc Burst',
      'Pulse Carbine',
      'Scatter Lance',
      'Arc Charger',
      'Ricochet Disc',
      'Rail Needle',
      'Nova Launcher',
      'Prism Beam',
      'Plasma Sabre',
    ]);
    for (const placeable of petwarsPlaceables) {
      expect(placeable.size.height).toBe(32);
      expect(placeable.source?.image).toMatch(/^atlases\/weapons\/.+\.png$/);
      expect(placeable.source?.properties).toMatchObject({ sourceGame: 'petwars' });
      expect(placeable.source?.properties?.['tileborne.visual.scale']).toBeGreaterThan(0);
      expect(placeable.source?.properties?.['tileborne.visual.handX']).toBeGreaterThan(0);
      expect(placeable.source?.properties?.['tileborne.visual.handY']).toBeGreaterThan(0);
      expect(placeable.source?.properties?.['tileborne.visual.muzzleX']).toBeGreaterThan(
        placeable.source?.properties?.['tileborne.visual.handX'] ?? 0,
      );
      expect(placeable.source?.properties?.['tileborne.visual.muzzleY']).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(packRoot, placeable.source?.image ?? ''))).toBe(true);
    }
  });
});
