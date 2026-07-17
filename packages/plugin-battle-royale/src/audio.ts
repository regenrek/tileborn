import type { RuntimeAudioBusDefinition, RuntimeAudioCueDefinition } from '@tileborne/runtime';

export const BR_AUDIO_BUS_CONTRIBUTION_ID = 'br-audio-bus';
export const BR_AUDIO_BUS_ID = 'battle-royale.sfx';

export const BR_AUDIO_CUES = {
  WeaponFire: 'battle-royale.weapon.fire',
  WeaponReload: 'battle-royale.weapon.reload',
  PlayerHit: 'battle-royale.player.hit',
  PlayerEliminated: 'battle-royale.player.eliminated',
  PickupCollect: 'battle-royale.pickup.collect',
  ZoneWarning: 'battle-royale.zone.warning',
} as const;

export type BattleRoyaleAudioCueId = (typeof BR_AUDIO_CUES)[keyof typeof BR_AUDIO_CUES];

export type BattleRoyaleAudioEvent =
  | { readonly type: 'weapon.fire' }
  | { readonly type: 'weapon.reload' }
  | { readonly type: 'player.hit' }
  | { readonly type: 'player.eliminated' }
  | { readonly type: 'pickup.collect' }
  | { readonly type: 'zone.warning' };

export interface BattleRoyaleAudioContributionData {
  readonly schemaVersion: 1;
  readonly buses: readonly RuntimeAudioBusDefinition[];
  readonly cues: readonly RuntimeAudioCueDefinition[];
}

export const battleRoyaleSfxBus: RuntimeAudioBusDefinition = {
  id: BR_AUDIO_BUS_ID,
  label: 'Battle Royale SFX',
  kind: 'sfx',
  defaultVolume: 0.85,
};

const cue = (
  id: BattleRoyaleAudioCueId,
  label: string,
  defaultVolume: number,
): RuntimeAudioCueDefinition => ({
  id,
  label,
  busId: BR_AUDIO_BUS_ID,
  defaultVolume,
});

export const battleRoyaleAudioCues: readonly RuntimeAudioCueDefinition[] = [
  cue(BR_AUDIO_CUES.WeaponFire, 'Weapon fire', 0.72),
  cue(BR_AUDIO_CUES.WeaponReload, 'Weapon reload', 0.62),
  cue(BR_AUDIO_CUES.PlayerHit, 'Player hit', 0.8),
  cue(BR_AUDIO_CUES.PlayerEliminated, 'Player eliminated', 0.88),
  cue(BR_AUDIO_CUES.PickupCollect, 'Pickup collect', 0.58),
  cue(BR_AUDIO_CUES.ZoneWarning, 'Zone warning', 0.76),
];

export const buildBattleRoyaleAudioBusData = (): BattleRoyaleAudioContributionData => ({
  schemaVersion: 1,
  buses: [battleRoyaleSfxBus],
  cues: battleRoyaleAudioCues,
});

export const battleRoyaleAudioCueForEvent = (
  event: BattleRoyaleAudioEvent,
): BattleRoyaleAudioCueId => {
  switch (event.type) {
    case 'weapon.fire':
      return BR_AUDIO_CUES.WeaponFire;
    case 'weapon.reload':
      return BR_AUDIO_CUES.WeaponReload;
    case 'player.hit':
      return BR_AUDIO_CUES.PlayerHit;
    case 'player.eliminated':
      return BR_AUDIO_CUES.PlayerEliminated;
    case 'pickup.collect':
      return BR_AUDIO_CUES.PickupCollect;
    case 'zone.warning':
      return BR_AUDIO_CUES.ZoneWarning;
  }
};

export const battleRoyaleAudioCueDefinitionForEvent = (
  event: BattleRoyaleAudioEvent,
): RuntimeAudioCueDefinition => {
  const cueId = battleRoyaleAudioCueForEvent(event);
  const audioCue = battleRoyaleAudioCues.find((candidate) => candidate.id === cueId);
  if (audioCue === undefined) {
    throw new Error(`Battle Royale audio cue "${cueId}" is not registered.`);
  }
  return audioCue;
};
