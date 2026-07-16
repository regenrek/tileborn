import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Checkbox, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn, typography } from '@tileborne/ui';
import { PanelTopOpenIcon, Trash2Icon, UserPlusIcon } from 'lucide-react';
import { gameObjectTypeIdForKey } from '@tileborne/core';
import type { JsonObject } from '@tileborne/core';
import type { PackId, ProjectId } from '@tileborne/core';

import { useUpdateMap, useUpdateProject } from '@/hooks/mutations';
import { useProject, useTilesetPack } from '@/hooks/queries';
import { useResolvedCatalog } from '@/hooks/queries';
import {
  applyBattleRoyaleAuthoringSettings,
  assessBattleRoyaleWeaponCompatibility,
  isBattleRoyaleWeaponCompatible,
  BATTLE_ROYALE_PALETTE_ACTIONS,
  readBattleRoyaleAuthoringSettings,
} from '@tileborne/plugin-battle-royale/authoring';
import {
  isDefaultBattleRoyalePlayerModelId,
  removeBattleRoyalePlayerModel,
  resolveBattleRoyalePlayerModels,
  upsertBattleRoyalePlayerModel,
} from '@tileborne/plugin-battle-royale/player-models';
import { buildPlayerModelRefFromPlaceable } from '@/lib/promote-player-model';
import {
  resolveSelectedModelId,
  writeLobbyModelSelection,
} from '@/lib/lobby-model-selection';
import { brushIntentMatchesPaletteAction } from '@/lib/palette-actions';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useDocumentLifecycle } from '@/lib/document-lifecycle';
import { useEditorUiStore } from '@/stores/editor-ui-store';

import type { ModeAuthoringPanelProps } from './mode-authoring-panels';
import { GameSettingsForm } from './game-settings-form';

export function BattleRoyaleAuthoringPanel({ projectId, map, settingsForm }: ModeAuthoringPanelProps) {
  const updateMap = useUpdateMap();
  const brushIntent = useEditorUiStore((state) => state.brushIntent);
  // BR translates the generic FLAT settings values into its durable nested
  // `BattleRoyaleConfig` override (persisted under `map.properties.<pluginId>`);
  // the form values it feeds the generic renderer are the flattened fields.
  const settingsValues = useMemo<JsonObject>(
    () => {
      const settings = readBattleRoyaleAuthoringSettings(map);
      return {
        maxPlayers: settings.maxPlayers,
        waitSec: settings.waitSec,
        shrinkSec: settings.shrinkSec,
        holdSec: settings.holdSec,
        shrinkPhases: settings.shrinkPhases,
        damagePerSecOutside: settings.damagePerSecOutside,
      };
    },
    [map],
  );
  // Live placement counts per contributed marker kind, used purely for status
  // (this panel no longer owns a parallel selection mode — markers are selected
  // from the Working Palette's "Markers & Tools" group).
  const markerStatus = useMemo(
    () =>
      BATTLE_ROYALE_PALETTE_ACTIONS.items.map((action) => ({
        action,
        count: map.objects.filter(
          (object) => object.kind === gameObjectTypeIdForKey(action.objectKind),
        ).length,
      })),
    [map.objects],
  );
  const [matchMode, setMatchMode] = useState(() => readBattleRoyaleAuthoringSettings(map).matchMode);
  const [matchEndPolicy, setMatchEndPolicy] = useState(() => readBattleRoyaleAuthoringSettings(map).matchEndPolicy);
  const [respawnEnabled, setRespawnEnabled] = useState(() => readBattleRoyaleAuthoringSettings(map).respawnEnabled);
  const [friendlyFire, setFriendlyFire] = useState(() => readBattleRoyaleAuthoringSettings(map).friendlyFire);
  const [startingWeaponId, setStartingWeaponId] = useState(() => readBattleRoyaleAuthoringSettings(map).startingWeaponId ?? '');
  const catalogQuery = useResolvedCatalog(projectId);
  const compatibleWeapons = useMemo(
    () => (catalogQuery.data?.weapons ?? []).filter(({ entry, label, origin, sourcePluginId }) =>
      isBattleRoyaleWeaponCompatible({
        id: String(entry.weapon.id),
        label,
        origin,
        ...(sourcePluginId === undefined ? {} : { sourcePluginId: String(sourcePluginId) }),
        deliveryTag: entry.delivery._tag,
      })),
    [catalogQuery.data?.weapons],
  );
  const selectedWeaponCompatibility = useMemo(() => {
    if (startingWeaponId.length === 0) return undefined;
    const selected = (catalogQuery.data?.weapons ?? []).find(
      ({ entry }) => String(entry.weapon.id) === startingWeaponId,
    );
    return assessBattleRoyaleWeaponCompatibility(
      startingWeaponId,
      selected === undefined
        ? undefined
        : {
            id: String(selected.entry.weapon.id),
            label: selected.label,
            origin: selected.origin,
            ...(selected.sourcePluginId === undefined
              ? {}
              : { sourcePluginId: String(selected.sourcePluginId) }),
            deliveryTag: selected.entry.delivery._tag,
          },
    );
  }, [catalogQuery.data?.weapons, startingWeaponId]);

  const saveSettings = async (values: Record<string, number>) => {
    // The generic form guarantees every declared field key is present + valid;
    // fall back to the current settings per field to stay type-safe under
    // `noUncheckedIndexedAccess` without changing behavior.
    const current = readBattleRoyaleAuthoringSettings(map);
    if (selectedWeaponCompatibility?.compatible === false) {
      notifyError(
        selectedWeaponCompatibility.message ??
          'Choose a Battle Royale projectile weapon before saving the loadout.',
      );
      return;
    }
    try {
      await updateMap.mutateAsync({
        projectId: projectId as ProjectId,
        map: applyBattleRoyaleAuthoringSettings(map, {
          maxPlayers: values.maxPlayers ?? current.maxPlayers,
          waitSec: values.waitSec ?? current.waitSec,
          shrinkSec: values.shrinkSec ?? current.shrinkSec,
          holdSec: values.holdSec ?? current.holdSec,
          shrinkPhases: values.shrinkPhases ?? current.shrinkPhases,
          damagePerSecOutside: values.damagePerSecOutside ?? current.damagePerSecOutside,
          matchMode,
          matchEndPolicy,
          respawnEnabled,
          friendlyFire,
          startingWeaponId,
        }),
      });
      notifySuccess('Battle Royale settings saved');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Battle Royale settings save failed');
      throw error;
    }
  };

  const durableRules = readBattleRoyaleAuthoringSettings(map);
  useDocumentLifecycle({
    id: `game-settings:${projectId}:${map.id}:battle-royale-rules`,
    scopeId: `map:${projectId}:${map.id}`,
    label: 'Battle Royale match rules',
    kind: 'game-settings',
    dirty:
      matchMode !== durableRules.matchMode ||
      matchEndPolicy !== durableRules.matchEndPolicy ||
      respawnEnabled !== durableRules.respawnEnabled ||
      friendlyFire !== durableRules.friendlyFire ||
      startingWeaponId !== (durableRules.startingWeaponId ?? ''),
    recoveryVersion: `${matchMode}:${matchEndPolicy}:${respawnEnabled}:${friendlyFire}:${startingWeaponId}`,
    save: () => saveSettings({
      maxPlayers: durableRules.maxPlayers,
      waitSec: durableRules.waitSec,
      shrinkSec: durableRules.shrinkSec,
      holdSec: durableRules.holdSec,
      shrinkPhases: durableRules.shrinkPhases,
      damagePerSecOutside: durableRules.damagePerSecOutside,
    }),
    discard: () => {
      setMatchMode(durableRules.matchMode);
      setMatchEndPolicy(durableRules.matchEndPolicy);
      setRespawnEnabled(durableRules.respawnEnabled);
      setFriendlyFire(durableRules.friendlyFire);
      setStartingWeaponId(durableRules.startingWeaponId ?? '');
    },
    snapshot: () => ({
      matchMode,
      matchEndPolicy,
      respawnEnabled,
      friendlyFire,
      startingWeaponId,
    }),
    recover: (snapshot) => {
      const value = snapshot as {
        readonly matchMode: typeof matchMode;
        readonly matchEndPolicy: typeof matchEndPolicy;
        readonly respawnEnabled: boolean;
        readonly friendlyFire: boolean;
        readonly startingWeaponId: string;
      };
      setMatchMode(value.matchMode);
      setMatchEndPolicy(value.matchEndPolicy);
      setRespawnEnabled(value.respawnEnabled);
      setFriendlyFire(value.friendlyFire);
      setStartingWeaponId(value.startingWeaponId);
    },
  });

  return (
    <div className="space-y-3" data-testid="battle-royale-authoring-panel">
      <p className={cn('px-0.5', typography.bodyMicro)}>
        Place markers from the Working Palette&rsquo;s <strong>Markers &amp; Tools</strong> group.
      </p>

      <div className="grid grid-cols-3 gap-1.5 text-center">
        {markerStatus.map(({ action, count }) => {
          const Icon = action.icon;
          // Cross-highlight (not select): mirrors which palette marker brush is
          // currently active so the inspector and palette agree on one thing.
          const active = brushIntentMatchesPaletteAction(brushIntent, action);
          return (
            <div
              key={action.id}
              data-testid={`br-marker-status-${action.objectKind}`}
              data-active={active ? 'true' : 'false'}
              className={cn(
                'rounded-md border bg-card px-2 py-1.5',
                active ? 'border-primary ring-1 ring-primary/60' : 'border-border',
              )}
            >
              <Icon className="mx-auto size-3.5 text-muted-foreground" aria-hidden />
              <p className={cn('mt-0.5 truncate', typography.rowMeta)}>{action.label}</p>
              <p className={cn(typography.rowTitle, 'tabular-nums')}>{count}</p>
            </div>
          );
        })}
      </div>

      {settingsForm !== undefined ? (
        <GameSettingsForm
          form={settingsForm}
          values={settingsValues}
          disabled={updateMap.isPending}
          saveLabel="Save BR settings"
          testIdPrefix="br-setting"
          onSave={saveSettings}
          onInvalid={notifyError}
          document={{
            id: `game-settings:${projectId}:${map.id}:battle-royale`,
            scopeId: `map:${projectId}:${map.id}`,
            label: 'Battle Royale settings',
          }}
        />
      ) : null}

      <div className="space-y-2 rounded-md border border-border p-2" data-testid="br-match-rules">
        <p className={cn(typography.sectionLabelMicro)}>Match rules</p>
        <Label className="space-y-1">
          <span className={typography.rowMeta}>Team mode</span>
          <Select value={matchMode} onValueChange={(value) => setMatchMode(value as typeof matchMode)}>
            <SelectTrigger data-testid="br-setting-matchMode"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="solo">Solo</SelectItem>
              <SelectItem value="duo">Duo</SelectItem>
              <SelectItem value="squad">Squad</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={respawnEnabled} onCheckedChange={(value) => {
            const enabled = value === true;
            setRespawnEnabled(enabled);
            if (enabled) setMatchEndPolicy('continuous');
          }} data-testid="br-setting-respawnEnabled" />
          Respawn after elimination
        </label>
        <Label className="space-y-1">
          <span className={typography.rowMeta}>Match end</span>
          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={matchEndPolicy} onChange={(event) => setMatchEndPolicy(event.target.value as typeof matchEndPolicy)} data-testid="br-setting-matchEndPolicy">
            <option value="last-standing" disabled={respawnEnabled}>Last standing</option>
            <option value="continuous">Continuous / no victory</option>
          </select>
        </Label>
        <Label className="space-y-1">
          <span className={typography.rowMeta}>Starting weapon / loadout</span>
          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={startingWeaponId} onChange={(event) => setStartingWeaponId(event.target.value)} data-testid="br-setting-startingWeaponId">
            <option value="">Automatic from placed weapon</option>
            {compatibleWeapons.map(({ entry, label }) => <option key={String(entry.weapon.id)} value={String(entry.weapon.id)}>{label}</option>)}
          </select>
          {selectedWeaponCompatibility?.compatible === false ? (
            <span className="text-xs text-destructive" role="alert">{selectedWeaponCompatibility.message}</span>
          ) : null}
        </Label>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={friendlyFire} onCheckedChange={(value) => setFriendlyFire(value === true)} data-testid="br-setting-friendlyFire" />
          Friendly fire
        </label>
        <p className={typography.bodyMicro} data-testid="br-match-end-summary">
          Match end: {respawnEnabled || matchEndPolicy === 'continuous' ? 'continuous play' : matchMode === 'solo' ? 'last player standing' : 'last team standing'}.
        </p>
      </div>

      <PlayerModelsSection projectId={projectId} />
    </div>
  );
}

/**
 * Per-project Battle Royale player-model roster (shared across all of the
 * project's BR maps). Lists the selectable models and promotes the active
 * sprite/placeable brush into the roster ("sprite → player model" bridge).
 */
function PlayerModelsSection({ projectId }: { readonly projectId: string }) {
  const navigate = useNavigate();
  const projectQuery = useProject(projectId);
  const project = projectQuery.data?.project;
  const updateProject = useUpdateProject();
  const brushIntent = useEditorUiStore((state) => state.brushIntent);
  const roster = useMemo(() => resolveBattleRoyalePlayerModels(project), [project]);
  const showingBundledDefaults =
    roster.length > 0 && roster.every((model) => isDefaultBattleRoyalePlayerModelId(model.id));
  // Persisted pre-match lobby selection (per project, reused across matches).
  const [selectionOverride, setSelectionOverride] = useState<string | undefined>();
  const selectedModelId =
    selectionOverride ?? resolveSelectedModelId(projectId, roster.map((model) => model.id));

  const selectLobbyModel = (modelId: string) => {
    writeLobbyModelSelection(projectId, modelId);
    setSelectionOverride(modelId);
  };

  const activePlaceable =
    brushIntent.kind === 'placeable'
      ? { packId: brushIntent.packId as PackId | undefined, placeableId: String(brushIntent.placeableId), clipId: brushIntent.clipId }
      : undefined;
  const packQuery = useTilesetPack(activePlaceable?.packId);

  const addActiveAsModel = async () => {
    if (project === undefined) {
      notifyError('Open a project before adding player models.');
      return;
    }
    if (activePlaceable?.packId === undefined || packQuery.data === undefined) {
      notifyError('Select a sprite/object brush from the palette first.');
      return;
    }
    const model = buildPlayerModelRefFromPlaceable(packQuery.data, {
      packId: activePlaceable.packId,
      placeableId: activePlaceable.placeableId,
      ...(activePlaceable.clipId === undefined ? {} : { clipId: activePlaceable.clipId }),
    });
    if (model === undefined) {
      notifyError('That sprite is missing required player-model clips or geometry metadata.');
      return;
    }
    try {
      await updateProject.mutateAsync({ project: upsertBattleRoyalePlayerModel(project, model) });
      notifySuccess(`Added "${model.label}" to the BR player-model roster`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to add player model');
    }
  };

  const removeModel = async (modelId: string) => {
    if (project === undefined) {
      return;
    }
    if (showingBundledDefaults && isDefaultBattleRoyalePlayerModelId(modelId)) {
      notifyError('Bundled default models are replaced by adding a project model.');
      return;
    }
    try {
      await updateProject.mutateAsync({
        project: removeBattleRoyalePlayerModel(project, modelId),
      });
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to remove player model');
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-3" data-testid="br-player-models-section">
      <div className="flex items-center justify-between gap-2">
        <p className={cn('px-0.5', typography.sectionLabelMicro)}>Player models</p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6 shrink-0"
            onClick={() =>
              void navigate({ to: '/projects/$projectId/player-models', params: { projectId } })
            }
            data-testid="br-player-model-open-editor"
            aria-label="Open Player Model Editor"
          >
            <PanelTopOpenIcon className="size-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2"
            disabled={updateProject.isPending || activePlaceable?.packId === undefined}
            onClick={() => void addActiveAsModel()}
            data-testid="br-player-model-add-active"
          >
            <UserPlusIcon className="size-3.5" aria-hidden />
            Use active sprite
          </Button>
        </div>
      </div>
      {roster.length === 0 ? (
        <p className={cn('px-0.5', typography.bodyMicro)}>
          No player models yet. Select an imported sprite brush and click{' '}
          <strong>Use active sprite</strong>.
        </p>
      ) : (
        <ul className="space-y-1" data-testid="br-player-model-list">
          {roster.map((model) => {
            const selected = model.id === selectedModelId;
            return (
              <li
                key={model.id}
                data-testid={`br-player-model-${model.id}`}
                data-selected={selected ? 'true' : 'false'}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border bg-card px-2 py-1',
                  selected ? 'border-primary ring-1 ring-primary/60' : 'border-border',
                )}
              >
                <button
                  type="button"
                  className={cn('min-w-0 flex-1 truncate text-left', typography.rowTitle)}
                  onClick={() => selectLobbyModel(model.id)}
                  data-testid={`br-player-model-select-${model.id}`}
                  aria-pressed={selected}
                  title={selected ? `${model.label} (selected in lobby)` : `Use ${model.label} in lobby`}
                >
                  {selected ? '● ' : '○ '}
                  {model.label}
                </button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-6 shrink-0"
                  disabled={updateProject.isPending || (showingBundledDefaults && isDefaultBattleRoyalePlayerModelId(model.id))}
                  onClick={() => void removeModel(model.id)}
                  data-testid={`br-player-model-remove-${model.id}`}
                  aria-label={`Remove ${model.label}`}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
