import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { GameObjectType } from "./object-type.js";
import { deriveOverlayVisuals, ResolvedOverlayVisual } from "./resolved-overlay-visuals.js";
import { gameObjectTypeIdForKey } from "./well-known.js";

const entity = (key: string, components: readonly unknown[]): GameObjectType =>
  Schema.decodeUnknownSync(GameObjectType)({
    id: gameObjectTypeIdForKey(key),
    schemaVersion: 1,
    label: key,
    family: "vfx",
    category: undefined,
    layerHint: undefined,
    components,
    instanceDefaults: {},
  });

const visualRef = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  _tag: "visual-ref",
  placeableId: "placeable:b4111e00-0000-4000-8000-00000000500d",
  assetId: undefined,
  width: 48,
  height: 48,
  anchors: {},
  renderProfile: { scale: 1, pivot: { x: 0.5, y: 0.62 } },
  ...overrides,
});

const overlay = (slot: string): Record<string, unknown> => ({ _tag: "overlay-visual", slot });

describe("deriveOverlayVisuals", () => {
  it("derives one resolved visual per claimed slot", () => {
    const shield = entity("test-shield", [visualRef(), overlay("shield")]);
    const shadow = entity("test-shadow", [
      visualRef({ placeableId: "placeable:b4111e00-0000-4000-8000-00000000500e" }),
      overlay("shadow"),
    ]);
    const bystander = entity("test-prop", [visualRef()]);

    const { visuals, issues } = deriveOverlayVisuals([shield, shadow, bystander]);

    expect(issues).toEqual([]);
    expect(visuals.map((visual) => visual.slot)).toEqual(["shadow", "shield"]);
    const resolvedShield = visuals.find((visual) => visual.slot === "shield")!;
    expect(resolvedShield.sourceEntityId).toBe(shield.id);
    expect(resolvedShield.visual.renderProfile?.pivot.y).toBe(0.62);
  });

  it("prefers a project-authored claimant over the plugin default", () => {
    const pluginShield = entity("plugin-shield", [visualRef(), overlay("shield")]);
    const projectShield = entity("project-shield", [
      visualRef({ placeableId: "placeable:b4111e00-0000-4000-8000-00000000500e" }),
      overlay("shield"),
    ]);

    const { visuals, issues } = deriveOverlayVisuals([pluginShield, projectShield], {
      projectTypeIds: new Set([String(projectShield.id)]),
    });

    expect(issues).toEqual([]);
    expect(visuals).toHaveLength(1);
    expect(visuals[0]!.sourceEntityId).toBe(projectShield.id);
  });

  it("resolves equal-precedence conflicts deterministically and reports them", () => {
    const first = entity("conflict-a", [visualRef(), overlay("shield")]);
    const second = entity("conflict-b", [visualRef(), overlay("shield")]);

    const { visuals, issues } = deriveOverlayVisuals([second, first]);

    expect(visuals).toHaveLength(1);
    const winnerId = [String(first.id), String(second.id)].sort()[0]!;
    expect(String(visuals[0]!.sourceEntityId)).toBe(winnerId);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('overlay slot "shield"');
  });

  it("reports render-incomplete claimants and yields no visual for the slot", () => {
    const bare = entity("test-bare", [
      visualRef({ placeableId: undefined, assetId: undefined }),
      overlay("hazard"),
    ]);

    const { visuals, issues } = deriveOverlayVisuals([bare]);

    expect(visuals).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe("overlay-visual -> visual-ref");
  });

  it("round-trips ResolvedOverlayVisual through its schema (artifact bake shape)", () => {
    const shield = entity("test-shield", [visualRef(), overlay("shield")]);
    const { visuals } = deriveOverlayVisuals([shield]);

    const decoded = Schema.decodeUnknownSync(ResolvedOverlayVisual)(
      Schema.encodeUnknownSync(ResolvedOverlayVisual)(visuals[0]!),
    );
    expect(decoded.slot).toBe("shield");
    expect(decoded.visual.width).toBe(48);
  });
});
