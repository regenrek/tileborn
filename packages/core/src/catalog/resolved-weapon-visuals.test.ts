import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeWeaponDefinitionId } from "../ids.js";
import { GameObjectType } from "./object-type.js";
import { deriveWeaponVisuals, ResolvedWeaponVisuals } from "./resolved-weapon-visuals.js";
import { gameObjectTypeIdForKey } from "./well-known.js";

const WEAPON_ID = makeWeaponDefinitionId("550e8400-e29b-41d4-a716-446655440100");

const entity = (key: string, components: readonly unknown[]): GameObjectType =>
  Schema.decodeUnknownSync(GameObjectType)({
    id: gameObjectTypeIdForKey(key),
    schemaVersion: 1,
    label: key,
    family: "weapon",
    category: undefined,
    layerHint: undefined,
    components,
    instanceDefaults: {},
  });

const visualRef = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  _tag: "visual-ref",
  placeableId: undefined,
  assetId: "asset:b4111e00-0000-4000-8000-000000000003",
  width: 64,
  height: 64,
  anchors: {
    grip: { point: { x: 0.2, y: 0.5 } },
    muzzle: { point: { x: 0.95, y: 0.45 }, rotationDeg: 0, zOffset: 1 },
  },
  ...overrides,
});

describe("deriveWeaponVisuals", () => {
  it("derives equipped + companion visuals from weapon entities", () => {
    const projectile = entity("test-projectile", [
      visualRef({ anchors: {}, rotationOffsetDeg: -90 }),
    ]);
    const weapon = entity("test-rifle", [
      visualRef(),
      { _tag: "equippable", slot: "weapon", attachAnchor: "grip" },
      {
        _tag: "weapon-ref",
        weaponId: WEAPON_ID,
        projectileEntityId: projectile.id,
        muzzleFlashEntityId: projectile.id,
        muzzleFlashDurationMs: 120,
      },
    ]);

    const { visuals, issues } = deriveWeaponVisuals([weapon, projectile]);

    expect(issues).toEqual([]);
    expect(visuals).toHaveLength(1);
    const resolved = visuals[0]!;
    expect(resolved.weaponId).toBe(WEAPON_ID);
    expect(resolved.attachAnchor).toBe("grip");
    expect(resolved.equipped.anchors["muzzle"]?.point.x).toBe(0.95);
    expect(resolved.equipped.anchors["grip"]?.point.y).toBe(0.5);
    expect(resolved.projectile?.rotationOffsetDeg).toBe(-90);
    expect(resolved.muzzleFlash?.durationMs).toBe(120);
    expect(resolved.impactVfx).toBeUndefined();
    expect(resolved.pickup).toBeUndefined();
  });

  it("round-trips ResolvedWeaponVisuals through its schema (artifact bake shape)", () => {
    const weapon = entity("test-rifle", [
      visualRef(),
      { _tag: "weapon-ref", weaponId: WEAPON_ID },
    ]);
    const { visuals } = deriveWeaponVisuals([weapon]);

    const decoded = Schema.decodeUnknownSync(ResolvedWeaponVisuals)(
      Schema.encodeUnknownSync(ResolvedWeaponVisuals)(visuals[0]!),
    );
    expect(decoded.weaponId).toBe(WEAPON_ID);
    expect(decoded.equipped.width).toBe(64);
  });

  it("reports issues for missing companions and render-incomplete entities", () => {
    const ghost = gameObjectTypeIdForKey("test-ghost");
    const bare = entity("test-bare", [
      // no placeableId/assetId — cannot render
      visualRef({ assetId: undefined }),
      { _tag: "weapon-ref", weaponId: WEAPON_ID, projectileEntityId: ghost },
    ]);

    const { visuals, issues } = deriveWeaponVisuals([bare]);

    expect(visuals).toEqual([]);
    expect(issues.some((issue) => issue.path === "visual-ref")).toBe(true);
    // Companion issues still surface even when the weapon itself cannot render,
    // so authors see every problem in one pass.
    expect(
      issues.some(
        (issue) =>
          issue.path === "weapon-ref.projectileEntityId" && issue.message.includes(ghost),
      ),
    ).toBe(true);
  });

  it("skips entities without weapon-ref", () => {
    const crate = entity("test-crate", [visualRef()]);
    expect(deriveWeaponVisuals([crate]).visuals).toEqual([]);
  });

  it("carries a custom equippable.attachAnchor into the resolved visuals", () => {
    const weapon = entity("test-sabre", [
      visualRef({ anchors: { hilt: { point: { x: 0.1, y: 0.9 } } } }),
      { _tag: "equippable", slot: "weapon", attachAnchor: "hilt" },
      { _tag: "weapon-ref", weaponId: WEAPON_ID },
    ]);

    const { visuals } = deriveWeaponVisuals([weapon]);
    expect(visuals[0]?.attachAnchor).toBe("hilt");
  });
});
