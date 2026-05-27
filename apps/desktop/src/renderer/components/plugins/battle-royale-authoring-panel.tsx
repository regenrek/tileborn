import { useEffect, useMemo, useState } from 'react';
import { Button, Input, cn, typography } from '@tileborne/ui';
import { CrosshairIcon, PackageIcon, RadioTowerIcon, SaveIcon } from 'lucide-react';
import type { TileborneMap } from '@tileborne/core';
import type { ProjectId } from '@tileborne/core';

import { useUpdateMap } from '@/hooks/mutations';
import {
  applyBattleRoyaleAuthoringSettings,
  battleRoyaleObjectCounts,
  BATTLE_ROYALE_AUTHORING_OBJECTS,
  readBattleRoyaleAuthoringSettings,
  type BattleRoyaleAuthoringSettings,
} from '@/lib/battle-royale-authoring';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface BattleRoyaleAuthoringPanelProps {
  readonly projectId: string;
  readonly map: TileborneMap;
}

const toolIcons = {
  'spawn-point': CrosshairIcon,
  'shrink-zone-anchor': RadioTowerIcon,
  'loot-crate': PackageIcon,
} as const;

const numericFields = [
  ['maxPlayers', 'Max players'],
  ['waitSec', 'Zone wait'],
  ['shrinkSec', 'Shrink time'],
  ['holdSec', 'Hold time'],
  ['shrinkPhases', 'Phases'],
  ['damagePerSecOutside', 'Zone DPS'],
] as const;

const toDraft = (settings: BattleRoyaleAuthoringSettings): Record<keyof BattleRoyaleAuthoringSettings, string> => ({
  maxPlayers: String(settings.maxPlayers),
  waitSec: String(settings.waitSec),
  shrinkSec: String(settings.shrinkSec),
  holdSec: String(settings.holdSec),
  shrinkPhases: String(settings.shrinkPhases),
  damagePerSecOutside: String(settings.damagePerSecOutside),
});

const parseDraft = (
  draft: Record<keyof BattleRoyaleAuthoringSettings, string>,
): BattleRoyaleAuthoringSettings | undefined => {
  const parsed = Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [key, Number(value)]),
  ) as Record<keyof BattleRoyaleAuthoringSettings, number>;
  return Object.values(parsed).every((value) => Number.isFinite(value) && value > 0)
    ? parsed
    : undefined;
};

export function BattleRoyaleAuthoringPanel({ projectId, map }: BattleRoyaleAuthoringPanelProps) {
  const updateMap = useUpdateMap();
  const setActiveTool = useEditorUiStore((state) => state.setActiveTool);
  const setStagedObjectKind = useEditorUiStore((state) => state.setStagedObjectKind);
  const activeTool = useEditorUiStore((state) => state.activeTool);
  const stagedObjectKind = useEditorUiStore((state) => state.stagedObjectKind);
  const settings = useMemo(() => readBattleRoyaleAuthoringSettings(map), [map]);
  const counts = useMemo(() => battleRoyaleObjectCounts(map), [map]);
  const [draft, setDraft] = useState(() => toDraft(settings));

  useEffect(() => {
    setDraft(toDraft(settings));
  }, [settings]);

  const parsed = parseDraft(draft);
  const saveSettings = async () => {
    if (!parsed) {
      notifyError('Battle Royale settings must be positive numbers.');
      return;
    }
    try {
      await updateMap.mutateAsync({
        projectId: projectId as ProjectId,
        map: applyBattleRoyaleAuthoringSettings(map, parsed),
      });
      notifySuccess('Battle Royale settings saved');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Battle Royale settings save failed');
    }
  };

  return (
    <div className="space-y-3" data-testid="battle-royale-authoring-panel">
      <div className="grid grid-cols-3 gap-1.5">
        {BATTLE_ROYALE_AUTHORING_OBJECTS.map((tool) => {
          const Icon = toolIcons[tool.kind];
          const selected = activeTool === 'objectPlace' && stagedObjectKind === tool.kind;
          return (
            <Button
              key={tool.kind}
              type="button"
              variant={selected ? 'secondary' : 'outline'}
              size="sm"
              className="h-auto min-w-0 flex-col gap-1 px-1.5 py-2"
              data-testid={`br-tool-${tool.kind}`}
              onClick={() => {
                setStagedObjectKind(tool.kind);
                setActiveTool('objectPlace');
              }}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className={cn('w-full truncate text-center', typography.micro)}>
                {tool.label}
              </span>
            </Button>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-center">
        <Metric label="Spawns" value={counts.spawnPoints} />
        <Metric label="Anchors" value={counts.shrinkAnchors} />
        <Metric label="Loot" value={counts.lootCrates} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {numericFields.map(([field, label]) => (
          <label key={field} className="min-w-0 space-y-1">
            <span className={cn('block truncate', typography.rowMeta)}>{label}</span>
            <Input
              type="number"
              min={1}
              step={field === 'damagePerSecOutside' ? 0.5 : 1}
              value={draft[field]}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [field]: event.target.value }))
              }
              data-testid={`br-setting-${field}`}
            />
          </label>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={updateMap.isPending || parsed === undefined}
        onClick={() => void saveSettings()}
        data-testid="br-settings-save"
      >
        <SaveIcon className="size-3.5" aria-hidden />
        Save BR settings
      </Button>
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1">
      <p className={typography.rowMeta}>{label}</p>
      <p className={cn(typography.rowTitle, 'tabular-nums')}>{value}</p>
    </div>
  );
}
