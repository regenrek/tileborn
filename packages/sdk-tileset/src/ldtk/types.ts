import type { ParseDiagnostic } from "../diagnostics.js";
import type { AutotileRule } from "../schemas/autotile-rule.js";
import type { TerrainClass } from "../schemas/terrain-class.js";
import type { TileId } from "../schemas/ids.js";
import type { TilesetPack } from "../schemas/tileset-pack.js";

export type LdtkProvenance = {
  readonly ldtkVersion: string;
  readonly projectPath: string;
  readonly projectIid: string;
  readonly identifier: string;
};

export type LdtkEnumValue = {
  readonly id: string;
  readonly tileIds: readonly number[];
};

export type LdtkEnum = {
  readonly identifier: string;
  readonly uid: number;
  readonly values: readonly LdtkEnumValue[];
};

export type LdtkEntityField = {
  readonly identifier: string;
  readonly value: unknown;
};

export type LdtkSpawnAnchor = {
  readonly kind: "spawn";
  readonly identifier: string;
  readonly entityDefUid: number;
  readonly px: readonly [number, number];
  readonly size: readonly [number, number];
  readonly fields: readonly LdtkEntityField[];
};

export type LdtkProp = {
  readonly kind: "prop";
  readonly identifier: string;
  readonly entityDefUid: number;
  readonly px: readonly [number, number];
  readonly size: readonly [number, number];
  readonly fields: readonly LdtkEntityField[];
};

export type LdtkEntityInstance = LdtkSpawnAnchor | LdtkProp;

export type LdtkTileCell = {
  readonly px: readonly [number, number];
  readonly src: readonly [number, number];
  readonly tileId: TileId;
};

export type LdtkTileLayer = {
  readonly type: "tiles";
  readonly identifier: string;
  readonly uid: number;
  readonly gridSize: number;
  readonly tilesetDefUid: number;
  readonly cells: readonly LdtkTileCell[];
};

export type LdtkIntGridValue = {
  readonly value: number;
  readonly identifier: string | null;
  readonly terrainClass?: TerrainClass;
};

export type LdtkIntGridLayer = {
  readonly type: "intgrid";
  readonly identifier: string;
  readonly uid: number;
  readonly gridSize: number;
  readonly width: number;
  readonly height: number;
  readonly intGridCsv: readonly number[];
  readonly values: readonly LdtkIntGridValue[];
};

export type LdtkAutoLayer = {
  readonly type: "auto";
  readonly identifier: string;
  readonly uid: number;
  readonly gridSize: number;
  readonly tilesetDefUid: number;
  readonly sourceLayerUid: number;
  readonly cells: readonly LdtkTileCell[];
  readonly autotileRules: readonly AutotileRule[];
};

export type LdtkEntitiesLayer = {
  readonly type: "entities";
  readonly identifier: string;
  readonly uid: number;
  readonly entities: readonly LdtkEntityInstance[];
};

export type LdtkLayer = LdtkTileLayer | LdtkIntGridLayer | LdtkAutoLayer | LdtkEntitiesLayer;

export type LdtkLevel = {
  readonly identifier: string;
  readonly uid: number;
  readonly pxWid: number;
  readonly pxHei: number;
  readonly layers: readonly LdtkLayer[];
};

export type LdtkParseResult = {
  readonly pack: TilesetPack;
  readonly provenance: LdtkProvenance;
  readonly enums: readonly LdtkEnum[];
  readonly projectTags: readonly string[];
  readonly levels: readonly LdtkLevel[];
  readonly diagnostics: readonly ParseDiagnostic[];
};
