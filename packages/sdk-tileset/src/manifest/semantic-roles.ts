import { AssetSemanticRole, type AssetSemanticRoleName } from "../schemas/semantic-role.js";
import type { Tile } from "../schemas/tile.js";
import type { TilesetPack } from "../schemas/tileset-pack.js";

const ROLE_ORDER: readonly AssetSemanticRoleName[] = [
  "floor",
  "wall",
  "water",
  "path",
  "decoration",
  "collision",
  "spawn-blocking",
];

const roleRank = (role: AssetSemanticRoleName): number => ROLE_ORDER.indexOf(role);

const lowerSet = (values: readonly string[]): ReadonlySet<string> =>
  new Set(values.map((value) => value.toLowerCase()));

const hasAny = (values: ReadonlySet<string>, candidates: readonly string[]): boolean =>
  candidates.some((candidate) => values.has(candidate));

const inferredRolesForTile = (tile: Tile): readonly AssetSemanticRoleName[] => {
  const tags = lowerSet(tile.tags);
  const terrainClass = tile.terrainClass._tag === "Some" ? tile.terrainClass.value.toLowerCase() : undefined;
  const roles = new Set<AssetSemanticRoleName>();
  for (const tag of tile.tags) {
    const role = semanticRoleFromText(tag);
    if (role !== undefined) roles.add(role);
  }
  if (terrainClass !== undefined) {
    const role = semanticRoleFromText(terrainClass);
    if (role !== undefined && (role !== "floor" || (!roles.has("water") && !tags.has("transparent")))) {
      roles.add(role);
    }
  }

  if (hasAny(tags, ["water", "river", "lake", "shore"])) roles.add("water");
  if (hasAny(tags, ["path", "road", "trail"])) roles.add("path");
  if (hasAny(tags, ["decoration", "decor", "prop", "props"])) roles.add("decoration");
  if (hasAny(tags, ["collision", "collider", "blocking"])) roles.add("collision");
  if (hasAny(tags, ["spawn-blocking", "spawn_blocking", "no-spawn"])) roles.add("spawn-blocking");
  if (hasAny(tags, ["wall", "solid"]) || terrainClass === "wall") roles.add("wall");
  if (
    hasAny(tags, ["floor", "ground", "grass", "terrain"]) ||
    (terrainClass === "floor" && !roles.has("water") && !tags.has("transparent"))
  ) {
    roles.add("floor");
  }

  if (tile.collisionMask._tag === "Some") {
    roles.add("collision");
  }

  return [...roles].sort((left, right) => roleRank(left) - roleRank(right));
};

const semanticRoleFromText = (value: string): AssetSemanticRoleName | undefined => {
  const text = value.toLowerCase();
  if (/\bwall\b|wall-/.test(text)) return "wall";
  if (/\bfloor\b|\bground\b|\bgrass\b/.test(text)) return "floor";
  if (/\bwater\b|\briver\b|\blake\b|\bshore\b/.test(text)) return "water";
  if (/\bpath\b|\broad\b|\btrail\b/.test(text)) return "path";
  if (/\bdecor\b|\bdecoration\b|\bprop\b|\bprops\b/.test(text)) return "decoration";
  return undefined;
};

const autotileRolesForPack = (pack: TilesetPack): readonly AssetSemanticRole[] => {
  const roles: AssetSemanticRole[] = [];
  for (const tileset of pack.tilesets) {
    for (const rule of tileset.autotileRules) {
      const role = rule.terrainClasses
        .map(semanticRoleFromText)
        .find((value): value is AssetSemanticRoleName => value !== undefined);
      if (role === undefined) continue;
      const tileIds = new Set(Object.values(rule.maskToTileIds).flat());
      for (const tileId of tileIds) {
        roles.push(new AssetSemanticRole({
          role,
          tileId,
          source: "tiled-metadata",
          confidence: 0.8,
        }));
      }
    }
  }
  return roles;
};

const placeableRolesForPack = (pack: TilesetPack): readonly AssetSemanticRole[] =>
  (pack.placeables ?? []).flatMap((placeable) => {
    const role = [placeable.name, ...placeable.tags]
      .map(semanticRoleFromText)
      .find((value): value is AssetSemanticRoleName => value !== undefined) ?? "decoration";
    return placeable.frames.map((frame) =>
      new AssetSemanticRole({
        role,
        tileId: frame.tileId,
        source: "tiled-metadata",
        confidence: 0.75,
      })
    );
  });

export const inferAssetSemanticRoles = (pack: TilesetPack): readonly AssetSemanticRole[] => {
  const byKey = new Map<string, AssetSemanticRole>();
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      for (const role of inferredRolesForTile(tile)) {
        byKey.set(`${role}:${tile.id}`, new AssetSemanticRole({
          role,
          tileId: tile.id,
          source: "tiled-metadata",
          confidence: role === "floor" || role === "wall" ? 0.9 : 0.75,
        }));
      }
    }
  }
  for (const role of autotileRolesForPack(pack)) {
    byKey.set(`${role.role}:${role.tileId}`, role);
  }
  for (const role of placeableRolesForPack(pack)) {
    byKey.set(`${role.role}:${role.tileId}`, role);
  }
  return [...byKey.values()].sort((left, right) =>
    roleRank(left.role) - roleRank(right.role) || String(left.tileId).localeCompare(String(right.tileId)),
  );
};
