import type { ProjectManifest, TileborneMap } from '@tileborne/core';
import { useMemo, useRef } from 'react';

import { useProject, useTilesetPacks } from '@/hooks/queries';
import { usePlayerModelPolicy } from '@/hooks/use-player-model-policy';
import {
  buildPlayerModelRenderData,
  loadPlayerModelAtlasSpec,
  type BuiltPlayerModel,
} from '@/lib/player-model-render';
import { resolveSelectedModelId } from '@/lib/lobby-model-selection';
import type { PlaytestPlayerModelConfig } from '@/lib/playtest-plugin-bridge';
import type { PlayerModelRenderData } from '@/lib/playtest-plugin-bridge';

export interface PlaytestPlayerModels {
  /** Resolved player models for the active project roster, ready to render. */
  readonly builtModels: readonly BuiltPlayerModel[];
  /** Effective selected model id (persisted lobby pick, else first roster model). */
  readonly selectedModelId: string | undefined;
  /** Roster (modelId + label) for a lobby picker UI. */
  readonly roster: readonly { readonly id: string; readonly label: string }[];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, packIds, packResults]);

  // `useTilesetPacks` (useQueries) returns a fresh array every render, so `built`
  // gets a new identity each render. Stabilize the reference by content
  // signature so the consuming playtest mount effect does not remount in a loop.
  const signature = built
    .map((entry) => `${entry.modelId}:${entry.data.assetId}:${entry.data.frames.length}`)
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
 * Assemble the projector config from built models + a per-player selection:
 * loads each model's atlas texture (once) and produces the catalog + atlas
 * specs the runtime must load. Async because atlas bytes are fetched.
 */
export const assemblePlaytestPlayerModelConfig = async (
  builtModels: readonly BuiltPlayerModel[],
  playerModelIds: ReadonlyMap<string, string>,
  defaultModelId?: string,
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
    playerModelIds,
    ...(defaultModelId === undefined ? {} : { defaultModelId }),
    atlasAssets: [...atlasById.values()],
  };
};
