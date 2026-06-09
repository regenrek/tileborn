import { Option, Schema } from "effect";

import {
  VisualAssetRoleRef,
  validateVisualAssetRoleRef,
  type VisualRoleValidationIssue,
} from "../asset/index.js";
import { ProjectManifest, type JsonValue } from "../project/index.js";

export const VISUAL_ASSET_ROLES_SETTINGS_KEY = "tileborne.visualAssetRoles";

const ProjectVisualAssetRoles = Schema.Array(VisualAssetRoleRef);

const invalidRoleMessage = (
  role: VisualAssetRoleRef,
  issues: readonly VisualRoleValidationIssue[],
): string =>
  `visual asset role "${role.id}" is invalid: ${issues
    .map((issue) => `${issue.path} ${issue.message}`)
    .join(", ")}`;

const assertValidVisualAssetRole = (role: VisualAssetRoleRef): void => {
  const issues = validateVisualAssetRoleRef(role);
  if (issues.length > 0) {
    throw new Error(invalidRoleMessage(role, issues));
  }
};

const roleSettingsValue = (roles: readonly VisualAssetRoleRef[]): JsonValue => {
  for (const role of roles) {
    assertValidVisualAssetRole(role);
  }
  return Schema.encodeUnknownSync(ProjectVisualAssetRoles)(roles) as JsonValue;
};

export const readProjectVisualAssetRoles = (
  project: ProjectManifest | undefined,
): readonly VisualAssetRoleRef[] => {
  const value = project?.settings?.[VISUAL_ASSET_ROLES_SETTINGS_KEY];
  return Option.match(Schema.decodeUnknownOption(ProjectVisualAssetRoles)(value), {
    onNone: () => [],
    onSome: (roles) => roles.filter((role) => validateVisualAssetRoleRef(role).length === 0),
  });
};

export const writeProjectVisualAssetRoles = (
  project: ProjectManifest,
  roles: readonly VisualAssetRoleRef[],
): ProjectManifest =>
  new ProjectManifest({
    ...project,
    settings: {
      ...(project.settings ?? {}),
      [VISUAL_ASSET_ROLES_SETTINGS_KEY]: roleSettingsValue(roles),
    },
  });

export const upsertProjectVisualAssetRole = (
  project: ProjectManifest,
  role: VisualAssetRoleRef,
): ProjectManifest => {
  const next = readProjectVisualAssetRoles(project).filter(
    (entry) => entry.roleKind !== role.roleKind,
  );
  return writeProjectVisualAssetRoles(project, [...next, role]);
};

export const removeProjectVisualAssetRole = (
  project: ProjectManifest,
  roleId: string,
): ProjectManifest =>
  writeProjectVisualAssetRoles(
    project,
    readProjectVisualAssetRoles(project).filter((role) => role.id !== roleId),
  );
