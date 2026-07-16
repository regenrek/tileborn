import type { GameObjectType, TileborneMap } from '@tileborne/core';
import type { WeaponCatalogEntryView } from '@tileborne/ipc-contracts';
import {
  assessBattleRoyaleWeaponCompatibility,
  readBattleRoyaleAuthoringSettings,
  resolveBattleRoyaleTeamTopology,
  selectBattleRoyaleSpawnTeamSlots,
} from '@tileborne/plugin-battle-royale/policy';
import { SPAWN_POINT_KIND } from '@tileborne/plugin-battle-royale/constants';

export interface BattleRoyaleReadinessIssue {
  readonly code: string;
  readonly title: string;
  readonly message: string;
  readonly path: string;
}

/** Plugin-policy adapter for the desktop's canonical readiness report. */
export const diagnoseBattleRoyaleMapReadiness = (
  map: TileborneMap,
  weapons: readonly WeaponCatalogEntryView[],
  objectTypes: readonly GameObjectType[] = [],
): readonly BattleRoyaleReadinessIssue[] => {
  const settings = readBattleRoyaleAuthoringSettings(map);
  const issues: BattleRoyaleReadinessIssue[] = [];
  if (settings.respawnEnabled && settings.matchEndPolicy !== 'continuous') {
    issues.push({
      code: 'game-mode.battle-royale.match-end-incompatible',
      title: 'Fix Battle Royale match-end rules',
      message: 'Respawn requires Continuous / no victory as the match-end policy.',
      path: 'roomRules.matchEndPolicy',
    });
  }
  if (settings.matchMode !== 'solo') {
    const spawnPointTypeIds = new Set([
      String(SPAWN_POINT_KIND),
      ...objectTypes
        .filter((objectType) => objectType.components.some((component) => component._tag === 'spawn-point'))
        .map((objectType) => String(objectType.id)),
    ]);
    const spawnSlots = selectBattleRoyaleSpawnTeamSlots(
      map.objects
        .filter((object) => spawnPointTypeIds.has(String(object.kind)))
        .map((object) => ({
          x: object.x,
          y: object.y,
          ...(typeof object.properties.team === 'string'
            ? { team: object.properties.team }
            : {}),
        })),
      settings.maxPlayers,
    );
    for (const topologyIssue of resolveBattleRoyaleTeamTopology(
      settings.matchMode,
      spawnSlots,
    ).issues) {
      issues.push({
        code: `game-mode.battle-royale.team-topology.${topologyIssue.code}`,
        title: 'Fix Battle Royale team topology',
        message: topologyIssue.message,
        path: 'spawnPoints.team',
      });
    }
  }
  if (settings.startingWeaponId !== undefined) {
    const selected = weapons.find(
      ({ entry }) => String(entry.weapon.id) === settings.startingWeaponId,
    );
    const compatibility = assessBattleRoyaleWeaponCompatibility(
      settings.startingWeaponId,
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
    if (!compatibility.compatible) {
      issues.push({
        code: `game-mode.battle-royale.starting-weapon.${compatibility.code}`,
        title: 'Choose a Battle Royale starting weapon',
        message: compatibility.message ?? 'The selected starting weapon is incompatible.',
        path: 'loadout.startingWeaponId',
      });
    }
  }
  return issues;
};
