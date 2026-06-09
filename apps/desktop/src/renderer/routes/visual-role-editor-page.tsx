import { useParams } from '@tanstack/react-router';
import {
  AttachmentAnchor,
  RenderProfile,
  VisualAnchorPoint,
  VisualAssetRoleRef,
  VisualFootprint,
  readProjectVisualAssetRoles,
  removeProjectVisualAssetRole,
  upsertProjectVisualAssetRole,
  validateVisualAssetRoleRef,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  type ClipId,
  type PackId,
  type VisualRoleKind,
} from '@tileborne/core';
import { Button, Input, Label, cn, typography } from '@tileborne/ui';
import { CrosshairIcon, LinkIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CloseableWorkspacePage } from '@/components/shell/closeable-workspace-page';
import {
  SpriteGeometryCanvas,
  type NormalizedPoint,
  type NormalizedRect,
  type SpriteGeometryHandle,
  type SpriteGeometryRect,
} from '@/components/visual-editor/sprite-geometry-canvas';
import { WeaponAttachmentPreview } from '@/components/visual-editor/weapon-attachment-preview';
import { useUpdateProject } from '@/hooks/mutations';
import { usePluginsList, useProject, useTilesetPack } from '@/hooks/queries';
import { PLUGIN_VISUAL_ROLE_POLICIES } from '@/lib/plugin-visual-role-policies';
import {
  buildVisualAssetRoleRefFromPlaceable,
  visualRolePlaceableProfileFromProperties,
} from '@/lib/visual-asset-role-authoring';
import {
  resolveVisualRolePolicy,
  type VisualRoleAnchorRequirement,
  type VisualRoleDefinition,
} from '@/lib/visual-role-policy';
import { diagnoseVisualRolePolicy } from '@/lib/visual-model-diagnostics';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

const FALLBACK_VISUAL_ROLE_DEFINITIONS: readonly VisualRoleDefinition[] = [
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon, label: 'Equipped weapon' },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.projectile, label: 'Projectile' },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.pickup, label: 'Pickup' },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash, label: 'Muzzle flash' },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx, label: 'Impact VFX' },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.shield, label: 'Shield' },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.shadow, label: 'Shadow' },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.hazard, label: 'Hazard' },
];

const roleKindKey = (kind: VisualRoleKind): string => String(kind);

const roleByKind = (roles: readonly VisualAssetRoleRef[]): ReadonlyMap<string, VisualAssetRoleRef> =>
  new Map(roles.map((role) => [roleKindKey(role.roleKind), role]));

const defaultAnchorPoint = (id: string): NormalizedPoint => {
  switch (id) {
    case 'hand':
      return { x: 0.28, y: 0.56 };
    case 'muzzle':
      return { x: 0.92, y: 0.5 };
    default:
      return { x: 0.5, y: 0.5 };
  }
};

const anchorLabel = (id: string): string =>
  id
    .split('-')
    .map((part) => (part.length === 0 ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
    .join(' ');

const anchorRequirementsForRole = (
  role: VisualAssetRoleRef,
  definition: VisualRoleDefinition | undefined,
): readonly VisualRoleAnchorRequirement[] => {
  const byId = new Map<string, VisualRoleAnchorRequirement>();
  for (const requirement of definition?.requiredAnchors ?? []) {
    byId.set(requirement.id, requirement);
  }
  for (const id of Object.keys(role.anchors)) {
    if (!byId.has(id)) {
      byId.set(id, { id, label: anchorLabel(id), kind: 'anchor' });
    }
  }
  return [...byId.values()].sort((left, right) => {
    const order = ['hand', 'muzzle'];
    const leftIndex = order.indexOf(left.id);
    const rightIndex = order.indexOf(right.id);
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    }
    return left.id.localeCompare(right.id);
  });
};

const roleWithPatch = (
  role: VisualAssetRoleRef,
  patch: {
    readonly label?: string | undefined;
    readonly renderProfile?: RenderProfile | undefined;
    readonly anchors?: Record<string, AttachmentAnchor> | undefined;
  },
): VisualAssetRoleRef =>
  new VisualAssetRoleRef({
    id: role.id,
    roleKind: role.roleKind,
    label: patch.label ?? role.label,
    ref: role.ref,
    ...(role.defaultClipId === undefined ? {} : { defaultClipId: role.defaultClipId }),
    renderProfile: patch.renderProfile ?? role.renderProfile,
    anchors: patch.anchors ?? role.anchors,
  });

const renderProfileWithPatch = (
  profile: RenderProfile,
  patch: {
    readonly scale?: number | undefined;
    readonly pivot?: NormalizedPoint | undefined;
    readonly footprint?: NormalizedRect | undefined;
  },
): RenderProfile =>
  new RenderProfile({
    scale: patch.scale ?? profile.scale,
    pivot: new VisualAnchorPoint(patch.pivot ?? profile.pivot),
    footprint: new VisualFootprint(patch.footprint ?? profile.footprint),
    nameplate: profile.nameplate,
    shadow: profile.shadow,
  });

const anchorWithPatch = (
  anchor: AttachmentAnchor | undefined,
  fallbackPoint: NormalizedPoint,
  patch: {
    readonly point?: NormalizedPoint | undefined;
    readonly rotationDeg?: number | undefined;
    readonly zOffset?: number | undefined;
  },
): AttachmentAnchor =>
  new AttachmentAnchor({
    point: new VisualAnchorPoint(patch.point ?? anchor?.point ?? fallbackPoint),
    rotationDeg: patch.rotationDeg ?? anchor?.rotationDeg ?? 0,
    zOffset: patch.zOffset ?? anchor?.zOffset ?? 0,
  });

const roleHandles = (
  role: VisualAssetRoleRef | undefined,
  definition: VisualRoleDefinition | undefined,
): readonly SpriteGeometryHandle[] => {
  if (role === undefined) {
    return [];
  }
  return [
    {
      id: 'pivot',
      label: 'Pivot',
      kind: 'pivot',
      point: role.renderProfile.pivot,
    },
    ...anchorRequirementsForRole(role, definition).map((requirement): SpriteGeometryHandle => {
      const anchor = role.anchors[requirement.id];
      return {
        id: requirement.id,
        label: requirement.label,
        kind: requirement.kind,
        point: anchor?.point ?? defaultAnchorPoint(requirement.id),
      };
    }),
  ];
};

const roleRects = (role: VisualAssetRoleRef | undefined): readonly SpriteGeometryRect[] =>
  role === undefined
    ? []
    : [
        {
          id: 'footprint',
          label: 'Footprint',
          kind: 'footprint',
          rect: role.renderProfile.footprint,
        },
      ];

const numberValue = (value: string): number | undefined => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function VisualRoleEditorPage() {
  const { projectId } = useParams({ from: '/editor/projects/$projectId/visual-roles' });
  const projectQuery = useProject(projectId);
  const pluginsQuery = usePluginsList();
  const updateProject = useUpdateProject();
  const project = projectQuery.data?.project;
  const brushIntent = useEditorUiStore((state) => state.brushIntent);
  const [selectedRoleKind, setSelectedRoleKind] = useState<VisualRoleKind>(
    WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
  );
  const [draftRole, setDraftRole] = useState<VisualAssetRoleRef | undefined>(undefined);
  const [isDirty, setIsDirty] = useState(false);
  const enabledPluginIds = useMemo(
    () =>
      (pluginsQuery.data?.plugins ?? [])
        .filter((plugin) => plugin.enabled)
        .map((plugin) => plugin.id),
    [pluginsQuery.data?.plugins],
  );
  const policy = useMemo(
    () => resolveVisualRolePolicy(enabledPluginIds, PLUGIN_VISUAL_ROLE_POLICIES, { project }),
    [enabledPluginIds, project],
  );
  const roleDefinitions =
    policy?.roleDefinitions.length === 0 || policy?.roleDefinitions === undefined
      ? FALLBACK_VISUAL_ROLE_DEFINITIONS
      : policy.roleDefinitions;
  const roleDefinitionByKind = useMemo(
    () => new Map(roleDefinitions.map((definition) => [roleKindKey(definition.kind), definition])),
    [roleDefinitions],
  );
  const projectRoles = useMemo(() => roleByKind(readProjectVisualAssetRoles(project)), [project]);
  const policyRoles = useMemo(() => roleByKind(policy?.roles ?? []), [policy?.roles]);
  const selectedRoleKey = roleKindKey(selectedRoleKind);
  const selectedOption = roleDefinitions.find((option) => option.kind === selectedRoleKind);
  const selectedDefinition = roleDefinitionByKind.get(selectedRoleKey);
  const projectOverride = projectRoles.get(selectedRoleKey);
  const policyDefault = policyRoles.get(selectedRoleKey);
  const effectiveRole = projectOverride ?? policyDefault;
  const validationIssues = useMemo(
    () => (draftRole === undefined ? [] : validateVisualAssetRoleRef(draftRole)),
    [draftRole],
  );
  const visualDiagnostics = useMemo(() => {
    if (policy === undefined) {
      return [];
    }
    const roles = [...policy.roles.filter((role) => roleKindKey(role.roleKind) !== selectedRoleKey)];
    if (draftRole !== undefined) {
      roles.push(draftRole);
    }
    return diagnoseVisualRolePolicy({ ...policy, roles }).filter(
      (diagnostic) => diagnostic.roleKind === selectedRoleKey || diagnostic.roleKind === undefined,
    );
  }, [draftRole, policy, selectedRoleKey]);
  const activePlaceable = useMemo(() => {
    if (brushIntent.kind !== 'placeable' || brushIntent.packId === undefined) {
      return undefined;
    }
    return {
      packId: brushIntent.packId as PackId,
      placeableId: String(brushIntent.placeableId),
      ...(brushIntent.clipId === undefined ? {} : { clipId: brushIntent.clipId as ClipId }),
    };
  }, [brushIntent]);
  const packQuery = useTilesetPack(activePlaceable?.packId);
  const activePlaceableEntry = useMemo(() => {
    if (activePlaceable === undefined) {
      return undefined;
    }
    return packQuery.data?.placeables?.find(
      (entry) => String(entry.id) === activePlaceable.placeableId,
    );
  }, [activePlaceable, packQuery.data]);
  const activeAssetLabel = useMemo(() => {
    if (activePlaceable === undefined) {
      return undefined;
    }
    const base = activePlaceableEntry?.name ?? activePlaceable.placeableId;
    const clip = activePlaceableEntry?.clips?.find(
      (entry) => String(entry.id) === activePlaceable.clipId,
    );
    return clip === undefined ? base : `${base} / ${clip.name}`;
  }, [activePlaceable, activePlaceableEntry]);
  const activeVisualProfile = useMemo(
    () => visualRolePlaceableProfileFromProperties(activePlaceableEntry?.source?.properties),
    [activePlaceableEntry],
  );
  const handles = useMemo(() => roleHandles(draftRole, selectedDefinition), [draftRole, selectedDefinition]);
  const rects = useMemo(() => roleRects(draftRole), [draftRole]);
  const previewRoles = useMemo(() => {
    const roles = new Map<string, VisualAssetRoleRef>();
    for (const option of roleDefinitions) {
      const key = roleKindKey(option.kind);
      const role =
        key === selectedRoleKey ? draftRole : projectRoles.get(key) ?? policyRoles.get(key);
      if (role !== undefined) {
        roles.set(key, role);
      }
    }
    return roles;
  }, [draftRole, policyRoles, projectRoles, roleDefinitions, selectedRoleKey]);

  useEffect(() => {
    setDraftRole(effectiveRole);
    setIsDirty(false);
  }, [effectiveRole, selectedRoleKey]);

  const updateHandle = (id: string, point: NormalizedPoint) => {
    setDraftRole((current) => {
      if (current === undefined) {
        return current;
      }
      setIsDirty(true);
      if (id === 'pivot') {
        return roleWithPatch(current, {
          renderProfile: renderProfileWithPatch(current.renderProfile, { pivot: point }),
        });
      }
      const existing = current.anchors[id];
      return roleWithPatch(current, {
        anchors: {
          ...current.anchors,
          [id]: anchorWithPatch(existing, defaultAnchorPoint(id), { point }),
        },
      });
    });
  };

  const updateFootprint = (rect: NormalizedRect) => {
    setDraftRole((current) => {
      if (current === undefined) {
        return current;
      }
      setIsDirty(true);
      return roleWithPatch(current, {
        renderProfile: renderProfileWithPatch(current.renderProfile, { footprint: rect }),
      });
    });
  };

  const updateScale = (scale: number) => {
    setDraftRole((current) => {
      if (current === undefined) {
        return current;
      }
      setIsDirty(true);
      return roleWithPatch(current, {
        renderProfile: renderProfileWithPatch(current.renderProfile, { scale }),
      });
    });
  };

  const updateLabel = (label: string) => {
    setDraftRole((current) => {
      if (current === undefined) {
        return current;
      }
      setIsDirty(true);
      return roleWithPatch(current, { label });
    });
  };

  const updateAnchorNumber = (
    id: string,
    patch: { readonly rotationDeg?: number | undefined; readonly zOffset?: number | undefined },
  ) => {
    setDraftRole((current) => {
      if (current === undefined) {
        return current;
      }
      setIsDirty(true);
      return roleWithPatch(current, {
        anchors: {
          ...current.anchors,
          [id]: anchorWithPatch(current.anchors[id], defaultAnchorPoint(id), patch),
        },
      });
    });
  };

  const assignActiveAsset = () => {
    if (activePlaceable === undefined) {
      notifyError('Select a sprite/object brush from the palette first.');
      return;
    }
    const role = buildVisualAssetRoleRefFromPlaceable({
      roleKind: selectedRoleKind,
      roleLabel: selectedOption?.label ?? String(selectedRoleKind),
      assetLabel: activeAssetLabel ?? activePlaceable.placeableId,
      activePlaceable: {
        ...activePlaceable,
        visualProfile: activeVisualProfile,
      },
    });
    setDraftRole(role);
    setIsDirty(true);
  };

  const saveRole = async () => {
    if (project === undefined || draftRole === undefined) {
      notifyError('Open a project before saving visual roles.');
      return;
    }
    if (validationIssues.length > 0) {
      notifyError('Fix visual role validation issues before saving.');
      return;
    }
    try {
      await updateProject.mutateAsync({ project: upsertProjectVisualAssetRole(project, draftRole) });
      setIsDirty(false);
      notifySuccess(`${selectedOption?.label ?? 'Visual role'} saved`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Visual role save failed');
    }
  };

  const removeOverride = async () => {
    if (project === undefined || projectOverride === undefined) {
      return;
    }
    try {
      await updateProject.mutateAsync({
        project: removeProjectVisualAssetRole(project, projectOverride.id),
      });
      setDraftRole(policyDefault);
      setIsDirty(false);
      notifySuccess(`${selectedOption?.label ?? 'Visual role'} override removed`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Visual role removal failed');
    }
  };

  const revertDraft = () => {
    setDraftRole(effectiveRole);
    setIsDirty(false);
  };

  return (
    <CloseableWorkspacePage
      title="Visual Role Editor"
      description="Author reusable visual-role metadata for the active project."
      maxWidthClassName="max-w-7xl"
      data-testid="visual-role-editor-page"
    >
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(18rem,24rem)_1fr]">
        <section className="min-w-0 rounded-md border border-border bg-card" aria-labelledby="visual-role-list-title">
          <div className="border-b border-border px-3 py-2">
            <h2 id="visual-role-list-title" className={typography.panelTitle}>
              Roles
            </h2>
          </div>
          <ul className="divide-y divide-border" data-testid="visual-role-editor-list">
            {roleDefinitions.map((option) => {
              const override = projectRoles.get(roleKindKey(option.kind));
              const fallback = policyRoles.get(roleKindKey(option.kind));
              const role = override ?? fallback;
              return (
                <li
                  key={roleKindKey(option.kind)}
                  data-testid={`visual-role-editor-row-${roleKindKey(option.kind)}`}
                >
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50',
                      selectedRoleKey === roleKindKey(option.kind) ? 'bg-primary/10' : '',
                    )}
                    onClick={() => setSelectedRoleKind(option.kind)}
                    data-selected={selectedRoleKey === roleKindKey(option.kind)}
                  >
                    <CrosshairIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate', typography.rowTitle)}>{option.label}</p>
                      <p className={cn('truncate', typography.rowMeta)}>
                        {role === undefined
                          ? 'Unassigned'
                          : override === undefined
                            ? `Default: ${role.label}`
                            : role.label}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded border px-1.5 py-0.5',
                        typography.bodyMicro,
                        override === undefined
                          ? 'border-border text-muted-foreground'
                          : 'border-primary/50 text-primary',
                      )}
                    >
                      {override === undefined ? 'Default' : 'Project'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="min-w-0 space-y-4" data-testid="visual-role-editor-canvas-host">
          <section className="rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={typography.sectionLabelMicro}>Editing</p>
                <h2 className={cn('truncate', typography.panelTitle)}>
                  {selectedOption?.label ?? String(selectedRoleKind)}
                </h2>
                <p className={cn('truncate', typography.rowMeta)}>
                  {draftRole === undefined
                    ? 'No role assigned. Use the active palette asset to create an override.'
                    : `${draftRole.label} · ${projectOverride === undefined ? 'policy default' : 'project override'}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={activePlaceable === undefined}
                  onClick={assignActiveAsset}
                  data-testid="visual-role-editor-use-active"
                >
                  <LinkIcon className="size-4" aria-hidden />
                  Use active asset
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!isDirty}
                  onClick={revertDraft}
                  data-testid="visual-role-editor-revert"
                >
                  <RotateCcwIcon className="size-4" aria-hidden />
                  Revert
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={projectOverride === undefined || updateProject.isPending}
                  onClick={() => void removeOverride()}
                  data-testid="visual-role-editor-remove"
                >
                  <Trash2Icon className="size-4" aria-hidden />
                  Remove override
                </Button>
                <Button
                  type="button"
                  disabled={
                    draftRole === undefined ||
                    !isDirty ||
                    validationIssues.length > 0 ||
                    updateProject.isPending
                  }
                  onClick={() => void saveRole()}
                  data-testid="visual-role-editor-save"
                >
                  <SaveIcon className="size-4" aria-hidden />
                  Save
                </Button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(12rem,1fr)_10rem]">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="visual-role-label">Label</Label>
                <Input
                  id="visual-role-label"
                  value={draftRole?.label ?? ''}
                  disabled={draftRole === undefined}
                  onChange={(event) => updateLabel(event.currentTarget.value)}
                  data-testid="visual-role-editor-label"
                />
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor="visual-role-scale">Render scale</Label>
                <Input
                  id="visual-role-scale"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={draftRole?.renderProfile.scale ?? 1}
                  disabled={draftRole === undefined}
                  onChange={(event) => {
                    const scale = numberValue(event.currentTarget.value);
                    if (scale !== undefined) {
                      updateScale(scale);
                    }
                  }}
                  data-testid="visual-role-editor-scale"
                />
              </div>
            </div>

            {draftRole === undefined ? null : (
              <div className="mt-3 space-y-2" data-testid="visual-role-editor-anchor-fields">
                <p className={typography.sectionLabelMicro}>Anchor transforms</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {anchorRequirementsForRole(draftRole, selectedDefinition).map((requirement) => {
                    const id = requirement.id;
                    const anchor = draftRole.anchors[id];
                    return (
                      <div key={id} className="rounded-md border border-border bg-background p-2">
                        <p className={typography.rowTitle}>{requirement.label}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label htmlFor={`visual-role-${id}-rotation`}>Rotation</Label>
                            <Input
                              id={`visual-role-${id}-rotation`}
                              type="number"
                              step={1}
                              value={anchor?.rotationDeg ?? 0}
                              onChange={(event) => {
                                const rotationDeg = numberValue(event.currentTarget.value);
                                if (rotationDeg !== undefined) {
                                  updateAnchorNumber(id, { rotationDeg });
                                }
                              }}
                              data-testid={`visual-role-editor-anchor-${id}-rotation`}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`visual-role-${id}-z`}>Z offset</Label>
                            <Input
                              id={`visual-role-${id}-z`}
                              type="number"
                              step={1}
                              value={anchor?.zOffset ?? 0}
                              onChange={(event) => {
                                const zOffset = numberValue(event.currentTarget.value);
                                if (zOffset !== undefined) {
                                  updateAnchorNumber(id, { zOffset });
                                }
                              }}
                              data-testid={`visual-role-editor-anchor-${id}-z`}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {validationIssues.length === 0 ? (
              <p className={cn('mt-3 text-emerald-500', typography.rowMeta)}>Validation OK</p>
            ) : (
              <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive">
                <p className={typography.rowTitle}>Validation issues</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {validationIssues.map((issue) => (
                    <li key={`${issue.path}:${issue.message}`} className={typography.rowMeta}>
                      {issue.path} {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {visualDiagnostics.length === 0 ? null : (
              <div
                className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2"
                data-testid="visual-role-editor-diagnostics"
              >
                <p className={typography.rowTitle}>Authoring diagnostics</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {visualDiagnostics.map((diagnostic) => (
                    <li
                      key={`${diagnostic.code}:${diagnostic.path}:${diagnostic.message}`}
                      className={typography.rowMeta}
                    >
                      <span className="font-medium">{diagnostic.severity}</span>{' '}
                      {diagnostic.path}: {diagnostic.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <WeaponAttachmentPreview roles={previewRoles} />

          <SpriteGeometryCanvas
            title={`${selectedOption?.label ?? 'Visual role'} Geometry`}
            handles={handles}
            rects={rects}
            snapStep={0.01}
            frames={[
              { id: 'idle', label: 'Idle' },
              { id: 'fire', label: 'Fire' },
            ]}
            activeFrameId="idle"
            onHandleChange={updateHandle}
            onRectChange={(id, rect) => {
              if (id === 'footprint') {
                updateFootprint(rect);
              }
            }}
            onResetDefaults={revertDraft}
          />
        </div>
      </div>
    </CloseableWorkspacePage>
  );
}
