import {
  deriveOverlayVisuals,
  deriveWeaponVisuals,
  type ProjectManifest,
  type TileborneMap,
} from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { useMemo, useRef } from 'react';

import {
  useAssetPacks,
  useProject,
  useResolvedCatalog,
  useTilesetPacks,
} from '@/hooks/queries';
import { usePlayerModelPolicy } from '@/hooks/use-player-model-policy';
import {
  buildPlayerModelRenderData,
  loadPlayerModelAtlasSpec,
  type BuiltPlayerModel,
} from '@/lib/player-model-render';
import { resolveSelectedModelId } from '@/lib/lobby-model-selection';
import type { PlaytestPlayerModelConfig } from '@/lib/playtest-plugin-bridge';
import type { PlayerModelRenderData } from '@/lib/playtest-plugin-bridge';
import type { PlaytestOverlayVisualConfig } from '@/lib/playtest-plugin-bridge';
import {
  buildOverlayVisualRenderData,
  loadOverlayVisualAtlasSpec,
  type BuiltOverlayVisual,
} from '@/lib/overlay-visual-render';
import {
  buildWeaponVisualRenderData,
  loadWeaponVisualAtlasSpec,
  type BuiltWeaponVisual,
} from '@/lib/weapon-visual-render';
import type {
  PlaytestWeaponVisualConfig,
  SpriteVisualRenderData,
  WeaponVisualRenderData,
} from '@/lib/playtest-plugin-bridge';

export interface PlaytestPlayerModels {
  /** Resolved player models for the active project roster, ready to render. */
  readonly builtModels: readonly BuiltPlayerModel[];
  /** Effective selected model id (persisted lobby pick, else first roster model). */
  readonly selectedModelId: string | undefined;
  /** Roster (modelId + label) for a lobby picker UI. */
  readonly roster: readonly { readonly id: string; readonly label: string }[];
}

export interface PlaytestOverlayVisuals {
  /** Per-slot overlay render data derived from `overlay-visual` catalog entities. */
  readonly builtOverlays: readonly BuiltOverlayVisual[];
}

export interface PlaytestWeaponVisuals {
  /** Per-weapon-entity render data derived from the merged catalog (ADR-0028). */
  readonly builtWeapons: readonly BuiltWeaponVisual[];
}

/**
 * Resolves the active project's player-model roster into runtime-ready render
 * data + the persisted lobby selection, for injection into the playtest
 * projector. Generic: keyed on the resolved player-model POLICY, not on any
 * plugin id.
 */
export function usePlaytestPlayerModels(
  projectId: string,
  map: TileborneMap | undefined,
): PlaytestPlayerModels {
  const projectQuery = useProject(projectId);
  const project = projectQuery.data?.project as ProjectManifest | undefined;
  const policy = usePlayerModelPolicy(map, project);
  const models = useMemo(() => policy?.models ?? [], [policy]);
  const packIds = useMemo(
    () => [...new Set(models.map((model) => model.ref.packId))],
    [models],
  );
  const packResults = useTilesetPacks(packIds);

  const built = useMemo(() => {
    const packByPackId = new Map<string, (typeof packResults)[number]['data']>();
    packIds.forEach((packId, index) => {
      const data = packResults[index]?.data;
      if (data !== undefined) {
        packByPackId.set(packId, data);
      }
    });
    const result: BuiltPlayerModel[] = [];
    for (const model of models) {
      const pack = packByPackId.get(model.ref.packId);
      if (pack === undefined) {
        continue;
      }
      const builtModel = buildPlayerModelRenderData(pack, model);
      if (builtModel !== undefined) {
        result.push(builtModel);
      }
    }
    return result;
  }, [models, packIds, packResults]);

  // `useTilesetPacks` (useQueries) returns a fresh array every render, so `built`
  // gets a new identity each render. Stabilize the reference by content
  // signature so the consuming playtest mount effect does not remount in a loop.
  const signature = built
    .map((entry) => {
      const clipSignature = Object.entries(entry.data.clips)
        .map(([key, clip]) => `${key}:${clip.frames.length}`)
        .join(',');
      return `${entry.modelId}:${entry.data.assetId}:${clipSignature}`;
    })
    .join('|');
  const stableRef = useRef<{ sig: string; value: readonly BuiltPlayerModel[] }>({
    sig: signature,
    value: built,
  });
  if (stableRef.current.sig !== signature) {
    stableRef.current = { sig: signature, value: built };
  }
  const builtModels = stableRef.current.value;

  const roster = useMemo(() => models.map((model) => ({ id: model.id, label: model.label })), [models]);
  const selectedModelId = useMemo(
    () => resolveSelectedModelId(projectId, models.map((model) => model.id)),
    [projectId, models],
  );

  return { builtModels, selectedModelId, roster };
}

/**
 * Resolves the project's OVERLAY visuals (shield/shadow/hazard slots) from the
 * merged game-object catalog: every entity with an `overlay-visual` component
 * claims a slot; project-origin claimants override plugin-shipped defaults
 * (core derivation precedence). Plugin-agnostic — no slot or plugin id is
 * named here.
 */
export function usePlaytestOverlayVisuals(projectId: string): PlaytestOverlayVisuals {
  const catalogQuery = useResolvedCatalog(projectId);
  const packsQuery = useAssetPacks();
  const packIds = useMemo(
    () => (packsQuery.data?.packs ?? []).map((pack) => String(pack.id)),
    [packsQuery.data?.packs],
  );
  const packResults = useTilesetPacks(packIds);

  const built = useMemo(() => {
    const entries = catalogQuery.data?.objectTypes ?? [];
    if (entries.length === 0) {
      return [];
    }
    const projectTypeIds = new Set(
      entries
        .filter((entry) => entry.origin === 'project')
        .map((entry) => String(entry.objectType.id)),
    );
    const { visuals } = deriveOverlayVisuals(
      entries.map((entry) => entry.objectType),
      { projectTypeIds },
    );
    if (visuals.length === 0) {
      return [];
    }
    const packs = new Map<string, TilesetPack>();
    packIds.forEach((packId, index) => {
      const data = packResults[index]?.data;
      if (data !== undefined) {
        packs.set(packId, data);
      }
    });
    const result: BuiltOverlayVisual[] = [];
    for (const overlayVisual of visuals) {
      const builtOverlay = buildOverlayVisualRenderData(packs, overlayVisual);
      if (builtOverlay !== undefined) {
        result.push(builtOverlay);
      }
    }
    return result;
  }, [catalogQuery.data?.objectTypes, packIds, packResults]);

  const signature = built
    .map((entry) => `${entry.slot}:${entry.data.assetId}:${entry.data.frames.length}`)
    .join('|');
  const stableRef = useRef<{ sig: string; value: readonly BuiltOverlayVisual[] }>({
    sig: signature,
    value: built,
  });
  if (stableRef.current.sig !== signature) {
    stableRef.current = { sig: signature, value: built };
  }

  return { builtOverlays: stableRef.current.value };
}

/**
 * Resolves the project's WEAPON visuals from the merged game-object catalog
 * (ADR-0028): every entity with a `weapon-ref` component derives its
 * equipped + companion visuals, which the shell builds into render data per
 * weaponId. Plugin-agnostic — the derivation is core logic over the resolved
 * catalog DTO; no plugin id or role kind is named here.
 */
export function usePlaytestWeaponVisuals(projectId: string): PlaytestWeaponVisuals {
  const catalogQuery = useResolvedCatalog(projectId);
  const packsQuery = useAssetPacks();
  const packIds = useMemo(
    () => (packsQuery.data?.packs ?? []).map((pack) => String(pack.id)),
    [packsQuery.data?.packs],
  );
  const packResults = useTilesetPacks(packIds);

  const built = useMemo(() => {
    const entries = catalogQuery.data?.objectTypes ?? [];
    if (entries.length === 0) {
      return [];
    }
    const { visuals } = deriveWeaponVisuals(entries.map((entry) => entry.objectType));
    if (visuals.length === 0) {
      return [];
    }
    const packs = new Map<string, TilesetPack>();
    packIds.forEach((packId, index) => {
      const data = packResults[index]?.data;
      if (data !== undefined) {
        packs.set(packId, data);
      }
    });
    const result: BuiltWeaponVisual[] = [];
    for (const weaponVisuals of visuals) {
      const builtWeapon = buildWeaponVisualRenderData(packs, weaponVisuals);
      if (builtWeapon !== undefined) {
        result.push(builtWeapon);
      }
    }
    return result;
  }, [catalogQuery.data?.objectTypes, packIds, packResults]);

  const signature = built
    .map((entry) => `${entry.weaponId}:${entry.data.equipped.assetId}:${entry.data.equipped.frames.length}`)
    .join('|');
  const stableRef = useRef<{ sig: string; value: readonly BuiltWeaponVisual[] }>({
    sig: signature,
    value: built,
  });
  if (stableRef.current.sig !== signature) {
    stableRef.current = { sig: signature, value: built };
  }

  return { builtWeapons: stableRef.current.value };
}

/**
 * Assemble the projector config from built models + a per-player selection:
 * loads each model's atlas texture (once) and produces the catalog + atlas
 * specs the runtime must load. Async because atlas bytes are fetched.
 */
export const assemblePlaytestPlayerModelConfig = async (
  builtModels: readonly BuiltPlayerModel[],
): Promise<PlaytestPlayerModelConfig> => {
  const catalog = new Map<string, PlayerModelRenderData>();
  const atlasById = new Map<string, Awaited<ReturnType<typeof loadPlayerModelAtlasSpec>>>();
  for (const built of builtModels) {
    catalog.set(built.modelId, built.data);
    for (const atlas of built.atlases) {
      if (!atlasById.has(atlas.renderableAssetId)) {
        atlasById.set(atlas.renderableAssetId, await loadPlayerModelAtlasSpec(atlas));
      }
    }
  }
  return {
    catalog,
    atlasAssets: [...atlasById.values()],
  };
};

export const assemblePlaytestOverlayVisualConfig = async (
  builtOverlays: readonly BuiltOverlayVisual[],
): Promise<PlaytestOverlayVisualConfig> => {
  const catalog = new Map<string, SpriteVisualRenderData>();
  const atlasById = new Map<string, Awaited<ReturnType<typeof loadOverlayVisualAtlasSpec>>>();
  for (const built of builtOverlays) {
    catalog.set(built.slot, built.data);
    for (const atlas of built.atlases) {
      if (!atlasById.has(atlas.renderableAssetId)) {
        atlasById.set(atlas.renderableAssetId, await loadOverlayVisualAtlasSpec(atlas));
      }
    }
  }
  return {
    catalog,
    atlasAssets: [...atlasById.values()],
  };
};

export const assemblePlaytestWeaponVisualConfig = async (
  builtWeapons: readonly BuiltWeaponVisual[],
): Promise<PlaytestWeaponVisualConfig> => {
  const catalog = new Map<string, WeaponVisualRenderData>();
  const atlasById = new Map<string, Awaited<ReturnType<typeof loadWeaponVisualAtlasSpec>>>();
  for (const built of builtWeapons) {
    catalog.set(built.weaponId, built.data);
    for (const atlas of built.atlases) {
      if (!atlasById.has(atlas.renderableAssetId)) {
        atlasById.set(atlas.renderableAssetId, await loadWeaponVisualAtlasSpec(atlas));
      }
    }
  }
  return {
    catalog,
    atlasAssets: [...atlasById.values()],
  };
};
