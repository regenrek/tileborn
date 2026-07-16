import { Option } from 'effect';

import type {
  GameObjectType,
  PackId,
  PlayerModelRef,
  ProjectManifest,
  TileborneMap,
} from '@tileborne/core';
import type { AssetLibraryUseSite } from '@tileborne/ipc-contracts';

interface EditorAssetIndex {
  readonly assets?: readonly { readonly id?: unknown }[] | undefined;
  readonly placeables?: readonly { readonly id?: unknown }[] | undefined;
}

export interface AssetPackUseSiteInput {
  readonly project: ProjectManifest;
  readonly packId: PackId;
  readonly maps: readonly TileborneMap[];
  readonly catalogObjectTypes: readonly GameObjectType[];
  readonly playerModels: readonly PlayerModelRef[];
  readonly editorIndex: EditorAssetIndex;
  readonly limit: number;
  readonly projectMapCount: number;
}

export interface AssetPackUseSiteResult {
  readonly useSites: readonly AssetLibraryUseSite[];
  readonly total: number;
  readonly truncated: boolean;
}

const visualRefFor = (objectType: GameObjectType) =>
  objectType.components.find((component) => component._tag === 'visual-ref');

/**
 * Pure projection from the canonical project/catalog/map/model state. The main
 * process owns the I/O; this function only identifies exact consumers and
 * emits renderer-agnostic navigation targets.
 */
export const buildAssetPackUseSites = (
  input: AssetPackUseSiteInput,
): AssetPackUseSiteResult => {
  const placeableIds = new Set(
    (input.editorIndex.placeables ?? []).flatMap((entry) =>
      entry.id === undefined ? [] : [String(entry.id)],
    ),
  );
  const assetIds = new Set(
    (input.editorIndex.assets ?? []).flatMap((entry) =>
      entry.id === undefined ? [] : [String(entry.id)],
    ),
  );
  const limit = Math.max(1, Math.trunc(input.limit));
  const useSites: AssetLibraryUseSite[] = [];
  const seen = new Set<string>();
  let total = 0;

  const add = (site: AssetLibraryUseSite) => {
    if (seen.has(site.id)) {
      return;
    }
    seen.add(site.id);
    total += 1;
    if (useSites.length < limit) {
      useSites.push(site);
    }
  };

  const dependency = input.project.assetPacks.find((entry) => String(entry.id) === input.packId);
  if (dependency !== undefined) {
    add(
      {
        id: `project-dependency:${input.packId}`,
        kind: 'project-dependency',
        label: input.project.name,
        detail: `Project dependency v${dependency.version}`,
        navigation: {
          kind: 'project-settings',
          projectId: input.project.id,
          path: 'assetPacks',
        },
      },
    );
  }

  for (const model of input.playerModels) {
    if (String(model.ref.packId) !== input.packId) {
      continue;
    }
    add(
      {
        id: `player-model:${model.id}`,
        kind: 'player-model',
        label: model.label,
        detail: `Player model uses ${model.ref.refId}`,
        navigation: {
          kind: 'player-model',
          projectId: input.project.id,
          modelId: model.id,
          path: `playerModels.${model.id}.ref`,
        },
      },
    );
    for (const [clipKey, clipId] of Object.entries(model.clips)) {
      add(
        {
          id: `animation:player-model:${model.id}:${clipKey}`,
          kind: 'animation',
          label: `${model.label} · ${clipKey}`,
          detail: `Animation binding ${String(clipId)}`,
          navigation: {
            kind: 'player-model',
            projectId: input.project.id,
            modelId: model.id,
            path: `playerModels.${model.id}.clips.${clipKey}`,
          },
        },
      );
    }
  }

  const targetEntityTypeIds = new Set<string>();
  for (const objectType of input.catalogObjectTypes) {
    const visualRef = visualRefFor(objectType);
    if (visualRef === undefined) {
      continue;
    }
    const placeableId = Option.getOrUndefined(visualRef.placeableId);
    const assetId = Option.getOrUndefined(visualRef.assetId);
    if (
      (placeableId === undefined || !placeableIds.has(String(placeableId))) &&
      (assetId === undefined || !assetIds.has(String(assetId)))
    ) {
      continue;
    }
    targetEntityTypeIds.add(String(objectType.id));
    add(
      {
        id: `entity:${objectType.id}`,
        kind: 'entity',
        label: objectType.label,
        detail: `Entity visual uses ${String(placeableId ?? assetId)}`,
        navigation: {
          kind: 'catalog',
          projectId: input.project.id,
          objectTypeId: objectType.id,
          path: 'visual-ref',
        },
      },
    );
  }

  for (const map of input.maps) {
    if (String(map.properties.tilesetPackId ?? '') === input.packId) {
      add(
        {
          id: `map:${map.id}:tileset`,
          kind: 'map',
          label: `Map ${map.id}`,
          detail: 'Map tileset and paint palette',
          navigation: {
            kind: 'map',
            projectId: input.project.id,
            mapId: map.id,
            path: 'properties.tilesetPackId',
          },
        },
      );
    }

    for (const object of map.objects) {
      const placement = object.placement;
      const placementPackId =
        placement === undefined ? undefined : Option.getOrUndefined(placement.packId);
      const placementPlaceableId = placement?.placeableId;
      const placementAssetId =
        placement === undefined ? undefined : Option.getOrUndefined(placement.assetId);
      const placementMatches =
        String(placementPackId ?? '') === input.packId ||
        (placementPlaceableId !== undefined && placeableIds.has(String(placementPlaceableId))) ||
        (placementAssetId !== undefined && assetIds.has(String(placementAssetId)));
      const entityMatches = targetEntityTypeIds.has(String(object.kind));
      if (!placementMatches && !entityMatches) {
        continue;
      }
      add(
        {
          id: `map-object:${map.id}:${object.id}`,
          kind: 'map-object',
          label: `Map object ${object.id}`,
          detail: `Placed on ${map.id} as ${object.kind}`,
          navigation: {
            kind: 'map-object',
            projectId: input.project.id,
            mapId: map.id,
            objectId: object.id,
            path: `objects.${object.id}`,
          },
        },
      );
      if (placement?.clipId !== undefined) {
        add(
          {
            id: `animation:map-object:${map.id}:${object.id}:${placement.clipId}`,
            kind: 'animation',
            label: `Map object animation ${object.id}`,
            detail: `Clip ${placement.clipId} on ${map.id}`,
            navigation: {
              kind: 'map-object',
              projectId: input.project.id,
              mapId: map.id,
              objectId: object.id,
              path: `objects.${object.id}.placement.clipId`,
            },
          },
        );
      }
    }
  }

  return {
    useSites,
    total,
    truncated: total > useSites.length || input.maps.length < input.projectMapCount,
  };
};
