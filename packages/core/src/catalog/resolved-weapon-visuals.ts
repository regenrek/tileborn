import { Effect, Option, Schema } from "effect";

import { AttachmentAnchorMap } from "../asset/anchors.js";
import { RenderProfile } from "../asset/render-profile.js";
import { AssetId, PlaceableId, WeaponDefinitionId } from "../ids.js";
import type { EquippableComponent, VisualRefComponent, WeaponRefComponent } from "./components.js";
import type { GameObjectType } from "./object-type.js";

/**
 * The render-ready projection of one entity's `visual-ref` (ADR-0028 §4c):
 * plain resolved data — render identity (placeable/asset id, the identities
 * the catalog owns), render profile, anchors, rotation. Deliberately
 * roleKind-free; derived, never authored. At least one of
 * placeableId/assetId is present (enforced by the derivation).
 */
export class ResolvedEntityVisual extends Schema.Class<ResolvedEntityVisual>(
  "ResolvedEntityVisual",
)({
  placeableId: Schema.optional(PlaceableId),
  assetId: Schema.optional(AssetId),
  width: Schema.Number,
  height: Schema.Number,
  renderProfile: Schema.optional(RenderProfile),
  anchors: AttachmentAnchorMap,
  rotationOffsetDeg: Schema.Number,
}) {}

/** A resolved VFX visual: an entity visual plus playback duration. */
export class ResolvedVfxVisual extends Schema.Class<ResolvedVfxVisual>("ResolvedVfxVisual")({
  visual: ResolvedEntityVisual,
  durationMs: Schema.Number,
}) {}

/**
 * Everything a renderer needs to draw one weapon (ADR-0028 §4c): derived per
 * weapon from the merged catalog by {@link deriveWeaponVisuals}, baked into
 * the runtime artifact at prepare/export time (§4e) — the catalog itself
 * never travels to the game-host.
 */
export class ResolvedWeaponVisuals extends Schema.Class<ResolvedWeaponVisuals>(
  "ResolvedWeaponVisuals",
)({
  weaponId: WeaponDefinitionId,
  /**
   * Name of the anchor (in `equipped.anchors`) by which the weapon mounts on
   * its holder — the `equippable.attachAnchor` reference (defaults to "grip").
   */
  attachAnchor: Schema.String.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed("grip")),
    Schema.withConstructorDefault(Effect.succeed("grip")),
  ),
  equipped: ResolvedEntityVisual,
  projectile: Schema.optional(ResolvedEntityVisual),
  muzzleFlash: Schema.optional(ResolvedVfxVisual),
  impactVfx: Schema.optional(ResolvedVfxVisual),
  pickup: Schema.optional(ResolvedEntityVisual),
}) {}

export interface WeaponVisualDerivationIssue {
  readonly objectTypeId: string;
  readonly path: string;
  readonly message: string;
}

export interface DeriveWeaponVisualsResult {
  readonly visuals: readonly ResolvedWeaponVisuals[];
  readonly issues: readonly WeaponVisualDerivationIssue[];
}

const DEFAULT_VFX_DURATION_MS = 180;

const visualRefOf = (objectType: GameObjectType): VisualRefComponent | undefined =>
  objectType.components.find(
    (component): component is VisualRefComponent => component._tag === "visual-ref",
  );

const weaponRefOf = (objectType: GameObjectType): WeaponRefComponent | undefined =>
  objectType.components.find(
    (component): component is WeaponRefComponent => component._tag === "weapon-ref",
  );

const equippableOf = (objectType: GameObjectType): EquippableComponent | undefined =>
  objectType.components.find(
    (component): component is EquippableComponent => component._tag === "equippable",
  );

/**
 * Build the {@link ResolvedEntityVisual} for one entity, or report why it
 * cannot render. A `visual-ref` resolves through its placeableId/assetId
 * (placeable preferred); a visual-ref with neither id yields no visual.
 * Shared by the weapon and overlay derivations — the one canonical
 * entity-visual resolver.
 */
export const resolveEntityVisual = (
  objectType: GameObjectType,
): { visual?: ResolvedEntityVisual; issue?: WeaponVisualDerivationIssue } => {
  const visualRef = visualRefOf(objectType);
  if (visualRef === undefined) {
    return {
      issue: {
        objectTypeId: objectType.id,
        path: "components",
        message: `entity ${objectType.id} has no visual-ref component`,
      },
    };
  }
  const placeableId = Option.getOrUndefined(visualRef.placeableId);
  const assetId = Option.getOrUndefined(visualRef.assetId);
  if (placeableId === undefined && assetId === undefined) {
    return {
      issue: {
        objectTypeId: objectType.id,
        path: "visual-ref",
        message: `entity ${objectType.id} visual-ref carries neither placeableId nor assetId`,
      },
    };
  }
  return {
    visual: new ResolvedEntityVisual({
      ...(placeableId === undefined ? {} : { placeableId }),
      ...(assetId === undefined ? {} : { assetId }),
      width: visualRef.width,
      height: visualRef.height,
      ...(visualRef.renderProfile === undefined
        ? {}
        : { renderProfile: visualRef.renderProfile }),
      anchors: visualRef.anchors,
      rotationOffsetDeg: visualRef.rotationOffsetDeg ?? 0,
    }),
  };
};

/**
 * Derive {@link ResolvedWeaponVisuals} for every entity carrying a
 * `weapon-ref` component (ADR-0028 §4c). Pure and worker-safe; takes the
 * MERGED object-type list (plugin catalogs ⊕ project fragment) so companion
 * references resolve across packs. Missing companions or render-incomplete
 * visuals are reported as issues, never thrown.
 */
export const deriveWeaponVisuals = (
  objectTypes: readonly GameObjectType[],
): DeriveWeaponVisualsResult => {
  const byId = new Map(objectTypes.map((objectType) => [String(objectType.id), objectType]));
  const visuals: ResolvedWeaponVisuals[] = [];
  const issues: WeaponVisualDerivationIssue[] = [];

  const companionVisual = (
    fromId: string,
    path: string,
    companionId: string | undefined,
  ): ResolvedEntityVisual | undefined => {
    if (companionId === undefined) {
      return undefined;
    }
    const companion = byId.get(companionId);
    if (companion === undefined) {
      issues.push({
        objectTypeId: fromId,
        path,
        message: `${fromId}: ${path} references unknown entity ${companionId}`,
      });
      return undefined;
    }
    const resolved = resolveEntityVisual(companion);
    if (resolved.issue !== undefined) {
      issues.push({ ...resolved.issue, path: `${path} -> ${resolved.issue.path}` });
    }
    return resolved.visual;
  };

  for (const objectType of objectTypes) {
    const weaponRef = weaponRefOf(objectType);
    if (weaponRef === undefined) {
      continue;
    }
    const equipped = resolveEntityVisual(objectType);
    if (equipped.issue !== undefined) {
      issues.push(equipped.issue);
    }

    // Companions are resolved (and their issues reported) even when the weapon
    // entity itself is render-incomplete, so authors see every problem at once.
    const projectile = companionVisual(
      objectType.id,
      "weapon-ref.projectileEntityId",
      weaponRef.projectileEntityId,
    );
    const muzzleFlash = companionVisual(
      objectType.id,
      "weapon-ref.muzzleFlashEntityId",
      weaponRef.muzzleFlashEntityId,
    );
    const impactVfx = companionVisual(
      objectType.id,
      "weapon-ref.impactVfxEntityId",
      weaponRef.impactVfxEntityId,
    );
    const pickup = companionVisual(
      objectType.id,
      "weapon-ref.pickupEntityId",
      weaponRef.pickupEntityId,
    );

    if (equipped.visual === undefined) {
      continue;
    }

    const equippable = equippableOf(objectType);
    visuals.push(
      new ResolvedWeaponVisuals({
        weaponId: weaponRef.weaponId,
        ...(equippable === undefined ? {} : { attachAnchor: String(equippable.attachAnchor) }),
        equipped: equipped.visual,
        ...(projectile === undefined ? {} : { projectile }),
        ...(muzzleFlash === undefined
          ? {}
          : {
              muzzleFlash: new ResolvedVfxVisual({
                visual: muzzleFlash,
                durationMs: weaponRef.muzzleFlashDurationMs ?? DEFAULT_VFX_DURATION_MS,
              }),
            }),
        ...(impactVfx === undefined
          ? {}
          : {
              impactVfx: new ResolvedVfxVisual({
                visual: impactVfx,
                durationMs: weaponRef.impactVfxDurationMs ?? DEFAULT_VFX_DURATION_MS,
              }),
            }),
        ...(pickup === undefined ? {} : { pickup }),
      }),
    );
  }

  return { visuals, issues };
};
