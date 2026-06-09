import { describe, expect, it } from "vitest";

import {
  AssetLibraryReference,
  RenderProfile,
  VisualAssetRoleRef,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
} from "../asset/index.js";
import { makePackId, makeProjectId } from "../ids.js";
import { ProjectManifest, makeProjectManifest } from "../project/index.js";
import {
  readProjectVisualAssetRoles,
  removeProjectVisualAssetRole,
  upsertProjectVisualAssetRole,
  VISUAL_ASSET_ROLES_SETTINGS_KEY,
  writeProjectVisualAssetRoles,
} from "./visual-asset-roles.js";

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix}`;
const PROJECT_ID = makeProjectId(uuid("446655440010"));
const PACK_ID = makePackId(uuid("446655440011"));

const project = () =>
  makeProjectManifest({
    id: PROJECT_ID,
    name: "Demo",
  });

const role = (input: { readonly id: string; readonly label: string }) =>
  new VisualAssetRoleRef({
    id: input.id,
    label: input.label,
    roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
    ref: new AssetLibraryReference({
      packId: PACK_ID,
      kind: "sprite",
      refId: "placeable:weapon",
    }),
  });

describe("project visual asset roles settings", () => {
  it("round-trips typed visual roles through project settings", () => {
    const next = writeProjectVisualAssetRoles(project(), [role({ id: "role:weapon", label: "Bow" })]);

    expect(next.settings?.[VISUAL_ASSET_ROLES_SETTINGS_KEY]).toMatchObject([
      {
        id: "role:weapon",
        roleKind: "equipped-weapon",
        label: "Bow",
        ref: { packId: PACK_ID, kind: "sprite", refId: "placeable:weapon" },
      },
    ]);
    expect(readProjectVisualAssetRoles(next)[0]).toBeInstanceOf(VisualAssetRoleRef);
    expect(readProjectVisualAssetRoles(next)[0]?.renderProfile).toBeInstanceOf(RenderProfile);
  });

  it("upserts by role kind and preserves unrelated project settings", () => {
    const first = writeProjectVisualAssetRoles(
      new ProjectManifest({
        ...project(),
        settings: { unrelated: true },
      }),
      [role({ id: "role:old", label: "Old Bow" })],
    );
    const next = upsertProjectVisualAssetRole(first, role({ id: "role:new", label: "New Bow" }));

    expect(next.settings?.unrelated).toBe(true);
    expect(readProjectVisualAssetRoles(next).map((entry) => entry.id)).toEqual(["role:new"]);
  });

  it("removes a role by id", () => {
    const first = writeProjectVisualAssetRoles(project(), [role({ id: "role:weapon", label: "Bow" })]);
    const next = removeProjectVisualAssetRole(first, "role:weapon");

    expect(readProjectVisualAssetRoles(next)).toEqual([]);
    expect(next.settings?.[VISUAL_ASSET_ROLES_SETTINGS_KEY]).toEqual([]);
  });

  it("treats malformed settings as empty and rejects invalid writes", () => {
    const malformed = new ProjectManifest({
      ...project(),
      settings: { [VISUAL_ASSET_ROLES_SETTINGS_KEY]: 7 },
    });

    expect(readProjectVisualAssetRoles(malformed)).toEqual([]);
    expect(() =>
      writeProjectVisualAssetRoles(project(), [
        new VisualAssetRoleRef({
          id: "",
          label: "Bow",
          roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
          ref: new AssetLibraryReference({
            packId: PACK_ID,
            kind: "sprite",
            refId: "placeable:weapon",
          }),
        }),
      ]),
    ).toThrow(/id must not be empty/);
  });
});
