import { Option } from 'effect';
import { Schema } from 'effect';

import type { ParseDiagnostic } from '../diagnostics.js';
import { CellSize, Tileset } from '../schemas/tileset.js';
import { Tile } from '../schemas/tile.js';
import { TilesetPack, TilesetPackAsset, TilesetPackLicense } from '../schemas/tileset-pack.js';
import { TerrainClass } from '../schemas/terrain-class.js';
import { UVRect } from '../schemas/uv-rect.js';
import type { TileId } from '../schemas/ids.js';

import { compileLdtkAutoRules } from './auto-rule.js';
import { ldtkAssetId, ldtkPackId, ldtkTileId, ldtkTilesetId } from './deterministic-id.js';
import { resolveExternalLevel, type FileReader } from './external-resolve.js';
import type {
  LdtkAutoLayer,
  LdtkEntityField,
  LdtkEntityInstance,
  LdtkEnum,
  LdtkIntGridLayer,
  LdtkIntGridValue,
  LdtkLayer,
  LdtkLevel,
  LdtkParseResult,
  LdtkProvenance,
  LdtkProp,
  LdtkSpawnAnchor,
  LdtkTileCell,
  LdtkTileLayer,
  LdtkEntitiesLayer,
} from './types.js';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const readString = (record: UnknownRecord, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
};

const readNumber = (record: UnknownRecord, key: string): number | undefined => {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
};

const readBoolean = (record: UnknownRecord, key: string): boolean | undefined => {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
};

const readArray = (record: UnknownRecord, key: string): readonly unknown[] | undefined => {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
};

const readPair = (value: unknown): readonly [number, number] | undefined => {
  if (!Array.isArray(value) || value.length < 2) {
    return undefined;
  }
  const [x, y] = value;
  if (typeof x !== 'number' || typeof y !== 'number') {
    return undefined;
  }
  return [x, y];
};

const terrainFromIdentifier = (identifier: string | null | undefined): TerrainClass | undefined => {
  if (identifier === null || identifier === undefined || identifier.length === 0) {
    return undefined;
  }
  return Schema.decodeUnknownOption(TerrainClass)(identifier).pipe(Option.getOrUndefined);
};

const tileUv = (
  tileIndex: number,
  columns: number,
  cellSize: number,
  margin: number,
  spacing: number,
): UVRect => {
  const col = tileIndex % columns;
  const row = Math.floor(tileIndex / columns);
  return new UVRect({
    x: margin + col * (cellSize + spacing),
    y: margin + row * (cellSize + spacing),
    w: cellSize,
    h: cellSize,
  });
};

const compileTileset = (
  projectPath: string,
  tilesetDef: UnknownRecord,
  autotileRulesByTileset: ReadonlyMap<number, Tileset['autotileRules']>,
): { readonly tileset: Tileset; readonly asset?: TilesetPackAsset } => {
  const uid = readNumber(tilesetDef, 'uid') ?? 0;
  const identifier = readString(tilesetDef, 'identifier') ?? `tileset-${uid}`;
  const relPath = readString(tilesetDef, 'relPath');
  const cellSize = readNumber(tilesetDef, 'tileGridSize') ?? 16;
  const margin = readNumber(tilesetDef, 'padding') ?? 0;
  const spacing = readNumber(tilesetDef, 'spacing') ?? 0;
  const columns = readNumber(tilesetDef, '__cWid') ?? 1;
  const rows = readNumber(tilesetDef, '__cHei') ?? 1;
  const tags =
    readArray(tilesetDef, 'tags')?.filter((tag): tag is string => typeof tag === 'string') ?? [];

  const enumTags = readArray(tilesetDef, 'enumTags') ?? [];
  const tileTags = new Map<number, string[]>();
  for (const enumTag of enumTags) {
    if (!isRecord(enumTag)) {
      continue;
    }
    const enumValueId = readString(enumTag, 'enumValueId');
    const tileIds =
      readArray(enumTag, 'tileIds')?.filter((id): id is number => typeof id === 'number') ?? [];
    if (enumValueId === undefined) {
      continue;
    }
    for (const tileIndex of tileIds) {
      const existing = tileTags.get(tileIndex) ?? [];
      tileTags.set(tileIndex, [...existing, enumValueId]);
    }
  }

  const tiles: Tile[] = [];
  for (let tileIndex = 0; tileIndex < columns * rows; tileIndex += 1) {
    const id = ldtkTileId(projectPath, uid, tileIndex);
    tiles.push(
      new Tile({
        id,
        uv: tileUv(tileIndex, columns, cellSize, margin, spacing),
        tags: [...tags, ...(tileTags.get(tileIndex) ?? [])],
        terrainClass: Option.none(),
        collisionMask: Option.none(),
        animation: Option.none(),
      }),
    );
  }

  const tileset = new Tileset({
    id: ldtkTilesetId(projectPath, uid),
    name: identifier,
    atlasAssetId:
      relPath === null || relPath === undefined
        ? ldtkAssetId(projectPath, identifier)
        : ldtkAssetId(projectPath, relPath),
    cellSize: new CellSize({ width: cellSize, height: cellSize }),
    margin,
    spacing,
    tiles,
    autotileRules: autotileRulesByTileset.get(uid) ?? [],
    variantFilters: [],
    terrainTransitions: [],
  });

  const asset =
    relPath === null || relPath === undefined
      ? undefined
      : new TilesetPackAsset({
          id: ldtkAssetId(projectPath, relPath),
          path: relPath,
          mime: 'image/png',
        });

  return asset === undefined ? { tileset } : { tileset, asset };
};

const compileEnums = (defs: UnknownRecord): readonly LdtkEnum[] => {
  const enums = readArray(defs, 'enums') ?? [];
  return enums.flatMap((entry): readonly LdtkEnum[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const identifier = readString(entry, 'identifier');
    const uid = readNumber(entry, 'uid');
    if (identifier === undefined || uid === undefined) {
      return [];
    }
    const values = (readArray(entry, 'values') ?? []).flatMap((valueEntry) => {
      if (!isRecord(valueEntry)) {
        return [];
      }
      const id = readString(valueEntry, 'id');
      if (id === undefined) {
        return [];
      }
      const tileIds =
        readArray(valueEntry, 'tileIds')?.filter(
          (tileId): tileId is number => typeof tileId === 'number',
        ) ?? [];
      return [{ id, tileIds }];
    });
    return [{ identifier, uid, values }];
  });
};

const compileIntGridValues = (layerDef: UnknownRecord): readonly LdtkIntGridValue[] => {
  const values = readArray(layerDef, 'intGridValues') ?? [];
  return values.flatMap((entry, index): readonly LdtkIntGridValue[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const explicitValue = readNumber(entry, 'value');
    const value = explicitValue ?? index + 1;
    const identifier = readString(entry, 'identifier') ?? null;
    const terrainClass = terrainFromIdentifier(identifier);
    return [
      {
        value,
        identifier,
        ...(terrainClass === undefined ? {} : { terrainClass }),
      },
    ];
  });
};

const terrainClassesForLayer = (
  intGridLayerDef: UnknownRecord | undefined,
): readonly TerrainClass[] => {
  if (intGridLayerDef === undefined) {
    return [];
  }
  return compileIntGridValues(intGridLayerDef).flatMap((entry) =>
    entry.terrainClass === undefined ? [] : [entry.terrainClass],
  );
};

const compileAutoLayerRules = (
  projectPath: string,
  defs: UnknownRecord,
  layerDefs: readonly UnknownRecord[],
): {
  readonly autotileRulesByTileset: Map<number, Tileset['autotileRules']>;
  readonly diagnostics: ParseDiagnostic[];
} => {
  const autotileRulesByTileset = new Map<number, Tileset['autotileRules']>();
  const diagnostics: ParseDiagnostic[] = [];

  for (const layerDef of layerDefs) {
    if (readString(layerDef, '__type') !== 'AutoLayer') {
      continue;
    }

    const layerUid = readNumber(layerDef, 'uid') ?? 0;
    const layerIdentifier = readString(layerDef, 'identifier') ?? `layer-${layerUid}`;
    const tilesetUid = readNumber(layerDef, 'tilesetDefUid') ?? 0;
    const sourceLayerUid = readNumber(layerDef, 'autoSourceLayerDefUid') ?? 0;
    const sourceLayerDef = layerDefs.find(
      (candidate) => readNumber(candidate, 'uid') === sourceLayerUid,
    );
    const tilesetDef = (readArray(defs, 'tilesets') ?? []).find(
      (candidate) => isRecord(candidate) && readNumber(candidate, 'uid') === tilesetUid,
    );
    const columns = isRecord(tilesetDef) ? (readNumber(tilesetDef, '__cWid') ?? 1) : 1;
    const ruleGroups = (readArray(layerDef, 'autoRuleGroups') ?? []).flatMap((group) =>
      isRecord(group) ? [group] : [],
    );

    const compiled = compileLdtkAutoRules({
      projectPath,
      layerUid,
      layerIdentifier,
      tilesetUid,
      columns,
      terrainClasses: terrainClassesForLayer(sourceLayerDef),
      ruleGroups: ruleGroups.map((group) => ({
        rules: (readArray(group, 'rules') ?? []).flatMap((rule) =>
          isRecord(rule) ? [rule as never] : [],
        ),
      })),
      tileIdForIndex: (index) => ldtkTileId(projectPath, tilesetUid, index),
    });

    diagnostics.push(...compiled.diagnostics);
    if (compiled.rules.length > 0) {
      autotileRulesByTileset.set(tilesetUid, compiled.rules);
    }
  }

  return { autotileRulesByTileset, diagnostics };
};

const entityFields = (entity: UnknownRecord): readonly LdtkEntityField[] =>
  (readArray(entity, 'fieldInstances') ?? []).flatMap((field) => {
    if (!isRecord(field)) {
      return [];
    }
    const identifier = readString(field, '__identifier') ?? readString(field, 'defId');
    if (identifier === undefined) {
      return [];
    }
    return [{ identifier, value: field['__value'] ?? field['realEditorValues'] ?? null }];
  });

const isSpawnEntity = (identifier: string, fields: readonly LdtkEntityField[]): boolean => {
  if (/spawn|player|start/i.test(identifier)) {
    return true;
  }
  return fields.some(
    (field) =>
      /spawn|player|start/i.test(field.identifier) &&
      (field.value === true || field.value === 1 || field.value === 'true'),
  );
};

const compileEntity = (
  entity: UnknownRecord,
  entityDefs: readonly UnknownRecord[],
): LdtkEntityInstance | undefined => {
  const identifier = readString(entity, '__identifier');
  const defUid = readNumber(entity, 'defUid');
  const px = readPair(entity['__pivot'] ?? entity['px']);
  const width = readNumber(entity, 'width') ?? readNumber(entity, '__width') ?? 16;
  const height = readNumber(entity, 'height') ?? readNumber(entity, '__height') ?? 16;
  if (identifier === undefined || defUid === undefined || px === undefined) {
    return undefined;
  }

  const def = entityDefs.find((candidate) => readNumber(candidate, 'uid') === defUid);
  const defIdentifier =
    def === undefined ? identifier : (readString(def, 'identifier') ?? identifier);
  const fields = entityFields(entity);
  const base = {
    identifier: defIdentifier,
    entityDefUid: defUid,
    px,
    size: [width, height] as const,
    fields,
  };

  if (isSpawnEntity(defIdentifier, fields)) {
    return { kind: 'spawn', ...base } satisfies LdtkSpawnAnchor;
  }

  return { kind: 'prop', ...base } satisfies LdtkProp;
};

const tileIdForCell = (
  projectPath: string,
  tilesetUid: number,
  columns: number,
  src: readonly [number, number],
): TileId => ldtkTileId(projectPath, tilesetUid, src[1] * columns + src[0]);

const compileTileCells = (
  projectPath: string,
  tilesetUid: number,
  columns: number,
  tiles: readonly unknown[],
): readonly LdtkTileCell[] =>
  tiles.flatMap((tile) => {
    if (!isRecord(tile)) {
      return [];
    }
    const px = readPair(tile['px']);
    const src = readPair(tile['src'] ?? tile['t']);
    if (px === undefined || src === undefined) {
      return [];
    }
    return [
      {
        px,
        src,
        tileId: tileIdForCell(projectPath, tilesetUid, columns, src),
      },
    ];
  });

const compileLayerInstance = (
  projectPath: string,
  layerInstance: UnknownRecord,
  layerDefs: readonly UnknownRecord[],
  entityDefs: readonly UnknownRecord[],
  tilesetDefs: readonly UnknownRecord[],
): LdtkLayer | undefined => {
  const layerDefUid =
    readNumber(layerInstance, 'layerDefUid') ?? readNumber(layerInstance, '__uid');
  const layerDef =
    layerDefs.find((candidate) => readNumber(candidate, 'uid') === layerDefUid) ??
    layerDefs.find(
      (candidate) =>
        readString(candidate, 'identifier') === readString(layerInstance, '__identifier'),
    );
  const type =
    (layerDef === undefined ? undefined : readString(layerDef, '__type')) ??
    readString(layerInstance, '__type');
  const identifier =
    readString(layerInstance, '__identifier') ??
    (layerDef === undefined ? undefined : readString(layerDef, 'identifier')) ??
    'layer';
  const uid =
    readNumber(layerInstance, '__uid') ??
    (layerDef === undefined ? undefined : readNumber(layerDef, 'uid')) ??
    0;
  const gridSize =
    readNumber(layerInstance, '__gridSize') ??
    (layerDef === undefined ? undefined : readNumber(layerDef, 'gridSize')) ??
    16;
  const tilesetUid =
    readNumber(layerInstance, '__tilesetDefUid') ??
    (layerDef === undefined ? undefined : readNumber(layerDef, 'tilesetDefUid')) ??
    0;
  const tilesetDef = tilesetDefs.find(
    (candidate): candidate is UnknownRecord =>
      isRecord(candidate) && readNumber(candidate, 'uid') === tilesetUid,
  );
  const columns = tilesetDef === undefined ? 1 : (readNumber(tilesetDef, '__cWid') ?? 1);

  if (type === 'Tiles') {
    return {
      type: 'tiles',
      identifier,
      uid,
      gridSize,
      tilesetDefUid: tilesetUid,
      cells: compileTileCells(
        projectPath,
        tilesetUid,
        columns,
        readArray(layerInstance, 'gridTiles') ?? [],
      ),
    } satisfies LdtkTileLayer;
  }

  if (type === 'IntGrid') {
    const width = readNumber(layerInstance, '__cWid') ?? 0;
    const height = readNumber(layerInstance, '__cHei') ?? 0;
    return {
      type: 'intgrid',
      identifier,
      uid,
      gridSize,
      width,
      height,
      intGridCsv: (readArray(layerInstance, 'intGridCsv') ?? []).filter(
        (value): value is number => typeof value === 'number',
      ),
      values: layerDef === undefined ? [] : compileIntGridValues(layerDef),
    } satisfies LdtkIntGridLayer;
  }

  if (type === 'AutoLayer') {
    const sourceLayerUid =
      layerDef === undefined ? 0 : (readNumber(layerDef, 'autoSourceLayerDefUid') ?? 0);
    const sourceLayerDef = layerDefs.find(
      (candidate) => readNumber(candidate, 'uid') === sourceLayerUid,
    );
    const compiledRules = compileLdtkAutoRules({
      projectPath,
      layerUid: uid,
      layerIdentifier: identifier,
      tilesetUid,
      columns,
      terrainClasses: terrainClassesForLayer(sourceLayerDef),
      ruleGroups:
        layerDef === undefined
          ? []
          : (readArray(layerDef, 'autoRuleGroups') ?? []).flatMap((group) =>
              isRecord(group)
                ? [
                    {
                      rules: (readArray(group, 'rules') ?? []).flatMap((rule) =>
                        isRecord(rule) ? [rule as never] : [],
                      ),
                    },
                  ]
                : [],
            ),
      tileIdForIndex: (index) => ldtkTileId(projectPath, tilesetUid, index),
    }).rules;

    return {
      type: 'auto',
      identifier,
      uid,
      gridSize,
      tilesetDefUid: tilesetUid,
      sourceLayerUid,
      cells: compileTileCells(
        projectPath,
        tilesetUid,
        columns,
        readArray(layerInstance, 'autoLayerTiles') ?? [],
      ),
      autotileRules: compiledRules,
    } satisfies LdtkAutoLayer;
  }

  if (type === 'Entities') {
    return {
      type: 'entities',
      identifier,
      uid,
      entities: (readArray(layerInstance, 'entityInstances') ?? []).flatMap((entity) => {
        const compiled = isRecord(entity) ? compileEntity(entity, entityDefs) : undefined;
        return compiled === undefined ? [] : [compiled];
      }),
    } satisfies LdtkEntitiesLayer;
  }

  return undefined;
};

const compileLevel = (
  projectPath: string,
  levelJson: UnknownRecord,
  defs: UnknownRecord,
  diagnostics: ParseDiagnostic[],
): LdtkLevel | undefined => {
  void diagnostics;
  void diagnostics;
  const identifier = readString(levelJson, 'identifier');
  const uid = readNumber(levelJson, 'uid');
  const pxWid = readNumber(levelJson, 'pxWid') ?? 0;
  const pxHei = readNumber(levelJson, 'pxHei') ?? 0;
  if (identifier === undefined || uid === undefined) {
    return undefined;
  }

  const layerDefs = (readArray(defs, 'layers') ?? []).flatMap((layer) =>
    isRecord(layer) ? [layer] : [],
  );
  const entityDefs = (readArray(defs, 'entities') ?? []).flatMap((entity) =>
    isRecord(entity) ? [entity] : [],
  );
  const tilesetDefs = (readArray(defs, 'tilesets') ?? []).flatMap((tileset) =>
    isRecord(tileset) ? [tileset] : [],
  );

  const layers = (readArray(levelJson, 'layerInstances') ?? []).flatMap((layerInstance) => {
    if (!isRecord(layerInstance)) {
      return [];
    }
    const compiled = compileLayerInstance(
      projectPath,
      layerInstance,
      layerDefs,
      entityDefs,
      tilesetDefs,
    );
    return compiled === undefined ? [] : [compiled];
  });

  return { identifier, uid, pxWid, pxHei, layers };
};

export type ParseLdtkProjectOptions = {
  readonly projectPath: string;
  readonly projectJson: unknown;
  readonly readFile?: FileReader;
  readonly realpath?: (absolutePath: string) => string;
};

/** Parse an LDtk project JSON document into a tileset pack and level data. */
export const parseLdtkProject = (options: ParseLdtkProjectOptions): LdtkParseResult => {
  const diagnostics: ParseDiagnostic[] = [];

  if (!isRecord(options.projectJson)) {
    return {
      pack: new TilesetPack({
        schemaVersion: 1,
        id: ldtkPackId(options.projectPath, 'invalid'),
        name: 'invalid-ldtk-project',
        version: '0',
        license: new TilesetPackLicense({
          spdxId: 'UNKNOWN',
          attribution: Option.none(),
          sourceUrl: Option.none(),
          notes: Option.none(),
          redistributable: false,
        }),
        tilesets: [],
        assets: [],
      }),
      provenance: {
        ldtkVersion: 'unknown',
        projectPath: options.projectPath,
        projectIid: 'invalid',
        identifier: 'invalid',
      },
      enums: [],
      projectTags: [],
      levels: [],
      diagnostics: [
        {
          _tag: 'LdtkInvalidProject',
          path: options.projectPath,
          message: 'LDtk project JSON must be an object',
          severity: 'error',
        },
      ],
    };
  }

  const project = options.projectJson;
  const defs = isRecord(project['defs']) ? project['defs'] : {};
  const jsonVersion = readString(project, 'jsonVersion') ?? 'unknown';
  const projectIid = readString(project, 'iid') ?? options.projectPath;
  const identifier = readString(project, 'identifier') ?? projectIid;
  const externalLevels = readBoolean(project, 'externalLevels') ?? false;
  const readFile = options.readFile;

  const provenance: LdtkProvenance = {
    ldtkVersion: jsonVersion,
    projectPath: options.projectPath,
    projectIid,
    identifier,
  };

  const layerDefs = (readArray(defs, 'layers') ?? []).flatMap((layer) =>
    isRecord(layer) ? [layer] : [],
  );
  const { autotileRulesByTileset, diagnostics: autoDiagnostics } = compileAutoLayerRules(
    options.projectPath,
    defs,
    layerDefs,
  );
  diagnostics.push(...autoDiagnostics);

  const tilesets: Tileset[] = [];
  const assets: TilesetPackAsset[] = [];
  for (const tilesetDef of readArray(defs, 'tilesets') ?? []) {
    if (!isRecord(tilesetDef)) {
      continue;
    }
    const compiled = compileTileset(options.projectPath, tilesetDef, autotileRulesByTileset);
    tilesets.push(compiled.tileset);
    if (compiled.asset !== undefined) {
      assets.push(compiled.asset);
    }
  }

  const pack = new TilesetPack({
    schemaVersion: 1,
    id: ldtkPackId(options.projectPath, projectIid),
    name: identifier,
    version: jsonVersion,
    license: new TilesetPackLicense({
      spdxId: 'UNKNOWN',
      attribution: Option.none(),
      sourceUrl: Option.none(),
      notes: Option.some(`Imported from LDtk ${jsonVersion} at ${options.projectPath}`),
      redistributable: false,
    }),
    tilesets,
    assets,
  });

  const levels: LdtkLevel[] = [];
  for (const levelEntry of readArray(project, 'levels') ?? []) {
    if (!isRecord(levelEntry)) {
      continue;
    }

    const externalRelPath = readString(levelEntry, 'externalRelPath');
    let levelJson: UnknownRecord = levelEntry;

    if (externalLevels && externalRelPath !== undefined) {
      if (readFile === undefined) {
        diagnostics.push({
          _tag: 'LdtkExternalLevelMissing',
          path: `${options.projectPath}/${externalRelPath}`,
          message: 'External level reference requires an injected file reader',
          severity: 'error',
          externalRelPath,
        });
        continue;
      }

      const resolved = resolveExternalLevel({
        projectPath: options.projectPath,
        externalRelPath,
        readFile,
        ...(options.realpath ? { realpath: options.realpath } : {}),
      });
      if (!resolved.ok) {
        diagnostics.push(resolved.diagnostic);
        continue;
      }

      if (!isRecord(resolved.level)) {
        diagnostics.push({
          _tag: 'LdtkExternalLevelMissing',
          path: `${options.projectPath}/${externalRelPath}`,
          message: 'External level JSON is invalid',
          severity: 'error',
          externalRelPath,
        });
        continue;
      }

      levelJson = {
        ...levelEntry,
        ...resolved.level,
        layerInstances: resolved.level['layerInstances'] ?? levelEntry['layerInstances'],
      };
    }

    const compiled = compileLevel(options.projectPath, levelJson, defs, diagnostics);
    if (compiled !== undefined) {
      levels.push(compiled);
    }
  }

  return {
    pack,
    provenance,
    enums: compileEnums(defs),
    projectTags:
      readArray(defs, 'tags')?.filter((tag): tag is string => typeof tag === 'string') ??
      readArray(project, 'tags')?.filter((tag): tag is string => typeof tag === 'string') ??
      [],
    levels,
    diagnostics,
  };
};
