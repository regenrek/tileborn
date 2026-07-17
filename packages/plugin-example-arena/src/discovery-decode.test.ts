import {
  PluginManifest,
  decodeGameObjectCatalog,
  decodeGameSettingsForm,
  decodeInputMap,
  decodeWeaponCatalog,
  discoverGameModes,
  findUndeclaredBoundActions,
  gameSettingsDefaults,
  materializeGameSettingsForm,
  mergeGameObjectCatalogs,
  mergeWeaponCatalogs,
  type GameModeManifest,
} from '@tileborne/plugin-api';
import { materializePluginManifestInput } from '../../services-plugin/src/filesystem.js';
import { Option, Result, Schema } from 'effect';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ARENA_PLUGIN_ID } from './constants.js';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arenaManifestPath = path.join(packageRoot, 'tileborne-plugin.json');
// The bundled Battle Royale plugin is the FIRST genre-neutral mode; reading its
// manifest alongside ours proves two modes are discovered via the same path.
const brManifestPath = path.join(
  packageRoot,
  '..',
  'plugin-battle-royale',
  'tileborne-plugin.json',
);

const readManifest = (manifestPath: string): PluginManifest =>
  Schema.decodeUnknownSync(PluginManifest)(
    materializePluginManifestInput(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown),
  );

const toGameModeManifest = (manifest: PluginManifest): GameModeManifest => ({
  pluginId: manifest.id,
  contributions: manifest.contributes,
});

/** Pull a runtime contribution's raw `data` straight from the manifest JSON. */
const readRuntimeContributionData = (
  manifestPath: string,
  slot: 'inputMaps' | 'weaponCatalogs' | 'gameObjectCatalogs',
  contributionId: string,
): unknown => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    contributes?: {
      runtime?: Record<string, readonly { readonly id: string; readonly data: unknown }[]>;
    };
  };
  const entry = manifest.contributes?.runtime?.[slot]?.find((c) => c.id === contributionId);
  if (entry === undefined) {
    throw new Error(`arena manifest is missing the ${slot} contribution ${contributionId}`);
  }
  return entry.data;
};

describe('example-arena proves genre-neutral extensibility', () => {
  describe('discovery (same generic discoverGameModes path as BR)', () => {
    it('discovers TWO game modes — battle royale and the example arena', () => {
      const arena = readManifest(arenaManifestPath);
      const battleRoyale = readManifest(brManifestPath);

      const modes = discoverGameModes([
        toGameModeManifest(battleRoyale),
        toGameModeManifest(arena),
      ]);

      expect(modes).toHaveLength(2);
      const ids = modes.map((mode) => mode.pluginId as string);
      expect(ids).toContain('@tileborne-plugins/battle-royale');
      expect(ids).toContain(ARENA_PLUGIN_ID);

      const arenaMode = modes.find((mode) => (mode.pluginId as string) === ARENA_PLUGIN_ID);
      expect(arenaMode?.runtimeSystemId).toBe('arena-runtime');
      expect(arenaMode?.hasAuthoringPanel).toBe(true);
      expect(arenaMode?.authoringSettingsPanelId).toBe('arena-settings');
      expect(arenaMode?.gameSettingsFormId).toBe('arena-settings-form');
      expect(arenaMode?.gameSettingsForm?.fields.map((field) => field.label)).toEqual([
        'Arena radius',
        'Enemy count',
      ]);
      expect(arenaMode?.label).toBe('Example Arena');
      expect(arenaMode?.rendererCapabilityId).toBe('example-arena.renderer');
      expect(arenaMode?.starterCapabilityId).toBe('example-arena.starter');
      expect(arenaMode?.mapValidatorId).toBe('arena-map-validator');
    });
  });

  describe('each contributed contract decodes against the engine schema', () => {
    it("inputMap decodes via decodeInputMap and differs from BR's default map", () => {
      const decoded = decodeInputMap(
        'arena-input-map',
        readRuntimeContributionData(arenaManifestPath, 'inputMaps', 'arena-input-map'),
      );
      expect(Result.isSuccess(decoded)).toBe(true);
      if (Result.isFailure(decoded)) {
        return;
      }
      expect(decoded.success.id).toBe('arena-default-bindings');
      // Every bound action carries a value-kind declaration.
      expect(findUndeclaredBoundActions(decoded.success)).toEqual([]);

      const bindings =
        decoded.success.schemeDefaults[
          'keyboard-mouse' as keyof typeof decoded.success.schemeDefaults
        ] ?? [];
      // PrimaryAction is bound to mouse-0 ONLY (BR also binds Space) — distinct map.
      const primary = bindings.filter((b) => (b.action as string) === 'core.PrimaryAction');
      expect(primary.some((b) => b.trigger._tag === 'mouseButton' && b.trigger.button === 0)).toBe(
        true,
      );
      expect(primary.some((b) => b.trigger._tag === 'key' && b.trigger.code === 'Space')).toBe(
        false,
      );
      // Declares a distinct extra action BR's default map does not.
      expect(bindings.some((b) => (b.action as string) === 'core.Dash')).toBe(true);
    });

    it('weaponCatalog decodes via decodeWeaponCatalog + merges (a MeleeDelivery weapon)', () => {
      const decoded = decodeWeaponCatalog(
        'arena-weapon-catalog',
        readRuntimeContributionData(arenaManifestPath, 'weaponCatalogs', 'arena-weapon-catalog'),
      );
      expect(Result.isSuccess(decoded)).toBe(true);
      if (Result.isFailure(decoded)) {
        return;
      }
      expect(decoded.success.weapons[0]?.delivery._tag).toBe('MeleeDelivery');

      const merged = mergeWeaponCatalogs([
        { contributionId: 'arena-weapon-catalog', catalog: decoded.success },
      ]);
      expect(Result.isSuccess(merged)).toBe(true);
    });

    it('gameObjectCatalog decodes via decodeGameObjectCatalog + merges (pickup grant resolves)', () => {
      const slotData = readRuntimeContributionData(
        arenaManifestPath,
        'gameObjectCatalogs',
        'arena-game-object-catalog',
      ) as { readonly indexPath: string };
      const catalogJson = JSON.parse(
        readFileSync(path.join(packageRoot, slotData.indexPath), 'utf8'),
      ) as unknown;

      const decoded = decodeGameObjectCatalog('arena-game-object-catalog', catalogJson);
      expect(Result.isSuccess(decoded)).toBe(true);
      if (Result.isFailure(decoded)) {
        return;
      }
      expect(decoded.success.objectTypes).toHaveLength(2);

      // Merge runs validateCatalog, which checks the loot-source `grantRefs`
      // item id resolves against the in-pack `items` (ADR-0023 section C).
      const merged = mergeGameObjectCatalogs([
        { contributionId: 'arena-game-object-catalog', catalog: decoded.success },
      ]);
      expect(Result.isSuccess(merged)).toBe(true);
    });

    it('settings form decodes from the EditorGameSettingsForm slot', () => {
      const manifest = readManifest(arenaManifestPath);
      const editor = Option.getOrUndefined(manifest.contributes.editor);
      const forms =
        editor === undefined ? [] : Option.getOrElse(editor.gameSettingsForms, () => []);
      expect(forms).toHaveLength(1);
      const form = forms[0];
      if (form === undefined || form._tag !== 'DeclarativeEditorGameSettingsFormContribution') {
        throw new Error('expected a declarative EditorGameSettingsForm contribution');
      }
      const decoded = decodeGameSettingsForm('arena-settings-form', form.data);
      expect(Result.isSuccess(decoded)).toBe(true);
      if (Result.isFailure(decoded)) {
        return;
      }
      const materialized = materializeGameSettingsForm(decoded.success);
      expect(materialized.scope).toBe('map');
      expect(materialized.fields.map((field) => field.key)).toEqual(['arenaRadius', 'enemyCount']);
      // Neutral fields — NOT zone/maxPlayers (BR-specific).
      expect(materialized.fields.map((field) => field.key)).not.toContain('maxPlayers');
      expect(gameSettingsDefaults(materialized)).toEqual({ arenaRadius: 32, enemyCount: 8 });
    });
  });
});
