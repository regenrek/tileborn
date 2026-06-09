import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { Button, cn, typography } from '@tileborne/ui';
import {
  BoxIcon,
  CrosshairIcon,
  FlameIcon,
  LinkIcon,
  PanelTopOpenIcon,
  ShieldIcon,
  SparklesIcon,
  Trash2Icon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react';
import {
  readProjectVisualAssetRoles,
  removeProjectVisualAssetRole,
  upsertProjectVisualAssetRole,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  type ClipId,
  type PackId,
  type VisualAssetRoleRef,
  type VisualRoleKind,
} from '@tileborne/core';
import { resolveBattleRoyaleVisualAssetRoles } from '@tileborne/plugin-battle-royale/visual-roles';

import { useUpdateProject } from '@/hooks/mutations';
import { useProject, useTilesetPack } from '@/hooks/queries';
import {
  buildVisualAssetRoleRefFromPlaceable,
  visualRolePlaceableProfileFromProperties,
} from '@/lib/visual-asset-role-authoring';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface VisualRoleOption {
  readonly roleKind: VisualRoleKind;
  readonly label: string;
  readonly Icon: LucideIcon;
}

const VISUAL_ROLE_OPTIONS: readonly VisualRoleOption[] = [
  {
    roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
    label: 'Equipped weapon',
    Icon: CrosshairIcon,
  },
  { roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.projectile, label: 'Projectile', Icon: ZapIcon },
  { roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.pickup, label: 'Pickup', Icon: BoxIcon },
  { roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash, label: 'Muzzle flash', Icon: FlameIcon },
  { roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx, label: 'Impact VFX', Icon: SparklesIcon },
  { roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.shield, label: 'Shield', Icon: ShieldIcon },
  { roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.shadow, label: 'Shadow', Icon: BoxIcon },
  { roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.hazard, label: 'Hazard', Icon: FlameIcon },
];

interface VisualAssetRolesSectionProps {
  readonly projectId: string;
}

const roleKindKey = (roleKind: VisualRoleKind): string => String(roleKind);

const roleByKind = (roles: readonly VisualAssetRoleRef[]): ReadonlyMap<string, VisualAssetRoleRef> =>
  new Map(roles.map((role) => [roleKindKey(role.roleKind), role]));

export function VisualAssetRolesSection({ projectId }: VisualAssetRolesSectionProps) {
  const navigate = useNavigate();
  const projectQuery = useProject(projectId);
  const project = projectQuery.data?.project;
  const updateProject = useUpdateProject();
  const brushIntent = useEditorUiStore((state) => state.brushIntent);
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
    const clip = activePlaceableEntry?.clips?.find((entry) => String(entry.id) === activePlaceable.clipId);
    return clip === undefined ? base : `${base} / ${clip.name}`;
  }, [activePlaceable, activePlaceableEntry]);
  const activeVisualProfile = useMemo(
    () => visualRolePlaceableProfileFromProperties(activePlaceableEntry?.source?.properties),
    [activePlaceableEntry],
  );
  const overrides = useMemo(
    () => roleByKind(readProjectVisualAssetRoles(project)),
    [project],
  );
  const effectiveAssignments = useMemo(
    () => roleByKind(resolveBattleRoyaleVisualAssetRoles(project)),
    [project],
  );

  const assignRole = async (option: VisualRoleOption) => {
    if (project === undefined) {
      notifyError('Open a project before assigning visual roles.');
      return;
    }
    if (activePlaceable === undefined) {
      notifyError('Select a sprite/object brush from the palette first.');
      return;
    }
    const role = buildVisualAssetRoleRefFromPlaceable({
      roleKind: option.roleKind,
      roleLabel: option.label,
      assetLabel: activeAssetLabel ?? activePlaceable.placeableId,
      activePlaceable: {
        ...activePlaceable,
        visualProfile: activeVisualProfile,
      },
    });
    try {
      await updateProject.mutateAsync({
        project: upsertProjectVisualAssetRole(project, role),
      });
      notifySuccess(`${option.label} visual role saved`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : `${option.label} visual role failed`);
    }
  };

  const removeRole = async (option: VisualRoleOption, role: VisualAssetRoleRef) => {
    if (project === undefined) {
      return;
    }
    try {
      await updateProject.mutateAsync({
        project: removeProjectVisualAssetRole(project, role.id),
      });
      notifySuccess(`${option.label} visual role removed`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : `${option.label} removal failed`);
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-3" data-testid="visual-asset-roles-section">
      <div className="flex items-center justify-between gap-2">
        <p className={cn('px-0.5', typography.sectionLabelMicro)}>Visual roles</p>
        <div className="flex min-w-0 items-center gap-1">
          <p
            className={cn('min-w-0 truncate text-right', typography.rowMeta)}
            title={activeAssetLabel ?? 'No active sprite'}
          >
            {activeAssetLabel ?? 'No active sprite'}
          </p>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6 shrink-0"
            onClick={() =>
              void navigate({ to: '/projects/$projectId/visual-roles', params: { projectId } })
            }
            data-testid="visual-role-open-editor"
            aria-label="Open Visual Role Editor"
          >
            <PanelTopOpenIcon className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <ul className="space-y-1" data-testid="visual-asset-role-list">
        {VISUAL_ROLE_OPTIONS.map((option) => {
          const override = overrides.get(roleKindKey(option.roleKind));
          const assigned = override ?? effectiveAssignments.get(roleKindKey(option.roleKind));
          const Icon = option.Icon;
          return (
            <li
              key={roleKindKey(option.roleKind)}
              data-testid={`visual-role-${roleKindKey(option.roleKind)}`}
              className="rounded-md border border-border bg-card px-2 py-1.5"
            >
              <div className="flex items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate', typography.rowTitle)}>{option.label}</p>
                  <p className={cn('truncate', typography.rowMeta)}>
                    {assigned === undefined
                      ? 'Unassigned'
                      : override === undefined
                        ? `Default: ${assigned.label}`
                        : assigned.label}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2"
                  disabled={updateProject.isPending || activePlaceable === undefined}
                  onClick={() => void assignRole(option)}
                  data-testid={`visual-role-${roleKindKey(option.roleKind)}-use-active`}
                  title={`Assign active sprite to ${option.label}`}
                >
                  <LinkIcon className="size-3.5" aria-hidden />
                  Use active
                </Button>
                {override === undefined ? null : (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-6 shrink-0"
                    disabled={updateProject.isPending}
                    onClick={() => void removeRole(option, override)}
                    data-testid={`visual-role-${roleKindKey(option.roleKind)}-remove`}
                    aria-label={`Remove ${option.label} visual role`}
                  >
                    <Trash2Icon className="size-3.5" aria-hidden />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
