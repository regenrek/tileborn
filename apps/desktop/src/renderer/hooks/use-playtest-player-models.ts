import { readProjectVisualAssetRoles, type ProjectManifest, type TileborneMap } from '@tileborne/core';
import { useMemo, useRef } from 'react';

import { usePluginsList, useProject, useTilesetPacks } from '@/hooks/queries';
import { usePlayerModelPolicy } from '@/hooks/use-player-model-policy';
import {
  buildPlayerModelRenderData,
  loadPlayerModelAtlasSpec,
  type BuiltPlayerModel,
} from '@/lib/player-model-render';
import { resolveSelectedModelId } from '@/lib/lobby-model-selection';
import type { PlaytestPlayerModelConfig } from '@/lib/playtest-plugin-bridge';
import type { PlayerModelRenderData } from '@/lib/playtest-plugin-bridge';
import type { PlaytestVisualRoleConfig } from '@/lib/playtest-plugin-bridge';
import { PLUGIN_VISUAL_ROLE_POLICIES } from '@/lib/plugin-visual-role-policies';
import { resolveVisualRolePolicy } from '@/lib/visual-role-policy';
import {
  buildVisualRoleRenderData,
  loadVisualRoleAtlasSpec,
  type BuiltVisualAssetRole,
} from '@/lib/visual-role-render';

export interface PlaytestPlayerModels {
  /** Resolved player models for the active project roster, ready to render. */
  readonly builtModels: readonly BuiltPlayerModel[];
  /** Effective selected model id (persisted lobby pick, else first roster model). */
  readonly selectedModelId: string | undefined;
  /** Roster (modelId + label) for a lobby picker UI. */
  readonly roster: readonly { readonly id: string; readonly label: string }[];
}

export interface PlaytestVisualRoles {
  /** Resolved project visual roles, ready to inject into a playtest projector. */
  readonly builtRoles: readonly BuiltVisualAssetRole[];
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

export function usePlaytestVisualRoles(projectId: string): PlaytestVisualRoles {
  const projectQuery = useProject(projectId);
  const pluginsQuery = usePluginsList();
  const project = projectQuery.data?.project as ProjectManifest | undefined;
  const roles = useMemo(() => {
    const enabledPluginIds = (pluginsQuery.data?.plugins ?? [])
      .filter((plugin) => plugin.enabled)
      .map((plugin) => plugin.id);
    return (
      resolveVisualRolePolicy(enabledPluginIds, PLUGIN_VISUAL_ROLE_POLICIES, { project })?.roles ??
      readProjectVisualAssetRoles(project)
    );
  }, [pluginsQuery.data?.plugins, project]);
  const packIds = useMemo(
    () => [...new Set(roles.map((role) => role.ref.packId))],
    [roles],
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
    const result: BuiltVisualAssetRole[] = [];
    for (const role of roles) {
      const pack = packByPackId.get(role.ref.packId);
      if (pack === undefined) {
        continue;
      }
      const builtRole = buildVisualRoleRenderData(pack, role);
      if (builtRole !== undefined) {
        result.push(builtRole);
      }
    }
    return result;
  }, [roles, packIds, packResults]);

  const signature = built
    .map((entry) => `${entry.roleKind}:${entry.data.assetId}:${entry.data.frames.length}`)
    .join('|');
  const stableRef = useRef<{ sig: string; value: readonly BuiltVisualAssetRole[] }>({
    sig: signature,
    value: built,
  });
  if (stableRef.current.sig !== signature) {
    stableRef.current = { sig: signature, value: built };
  }

  return { builtRoles: stableRef.current.value };
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

export const assemblePlaytestVisualRoleConfig = async (
  builtRoles: readonly BuiltVisualAssetRole[],
): Promise<PlaytestVisualRoleConfig> => {
  const catalog = new Map<string, BuiltVisualAssetRole['data']>();
  const atlasById = new Map<string, Awaited<ReturnType<typeof loadVisualRoleAtlasSpec>>>();
  for (const built of builtRoles) {
    catalog.set(built.roleKind, built.data);
    for (const atlas of built.atlases) {
      if (!atlasById.has(atlas.renderableAssetId)) {
        atlasById.set(atlas.renderableAssetId, await loadVisualRoleAtlasSpec(atlas));
      }
    }
  }
  return {
    catalog,
    atlasAssets: [...atlasById.values()],
  };
};
