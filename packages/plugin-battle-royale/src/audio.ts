import type { RuntimeAudioBusDefinition, RuntimeAudioCueDefinition } from '@tileborne/runtime';

export const BR_AUDIO_BUS_CONTRIBUTION_ID = 'br-audio-bus';
export const BR_AUDIO_BUS_ID = 'battle-royale.sfx';
export const BR_MUSIC_BUS_ID = 'battle-royale.music';
export const BR_DEFAULT_AUDIO_DATA_URL =
  'data:audio/wav;base64,UklGRqQHAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYAHAAAAADoXWSjfLhQpfhh5ARHqbNgt0TzWROYP/Z8UxSa7Lmoq9BppBLbsFNpo0fvU2+Mg+vARCiVoLpUrTx1VB27v4tvT0eXTj+E39y8PKSPnLZUsjB86Cjjy1N1s0vzSYd9Y9F4MJSE3LWctqiEUDQ/16d8y00HSVN2E8YEJAB9ZLAsupSPhD/H3H+In1LTRa9u/7psGuxxPK4EufCWeEtv6c+RH1VXRptkL7K4DWRoYKsguLidIFcv94uaT1ibRCNhr6bwA3Be4KOAuuCjcF7wAa+kI2CbRk9bi5sv9SBUuJ8guGCpZGq4DC+ym2VXRR9Vz5Nv6nhJ8JYEuTyu7HJsGv+5r27TRJ9Qf4vH34Q+lIwsuWSwAH4EJhPFU3UHSMtPp3w/1FA2qIWctNy0lIV4MWPRh3/zSbNLU3TjyOgqMH5Us5y0pIy8PN/eP4eXT09Hi227vVQdPHZUraC4KJfARIPrb4/vUaNEU2rbsaQT0Gmoquy7FJp8UD/1E5jzWLdFs2BHqeQF+GBQp3y5ZKDoXAADG6KfXIdHs1oLnh/7vFZQn0y7EKbwZ8QJh6zvZRdGW1Qzll/tKE+wlmC4FKyUc4AUQ7vbamNFr1LHiq/iSEB4kLS4bLHEeyQjR8NfcGdJr03TgxvXIDSwilC0ELZ8gqAui89veydKZ0lbe7PLxChcgziy/LawifA5/9gDhp9P10VvcH/APCOEd2StMLpUkQRFl+UXjsdR/0YTaYu0lBY0buSqrLlom9RNS/Kfl6NU40dLYuOo1Ah4ZbSnaLvgnlRZE/yToSNcg0UjXJOhE/5UW+CfaLm0pHhk1Arjq0tg40ejVp+VS/PUTWiarLrkqjRslBWLthNp/0bHUReNl+UERlSRMLtkr4R0PCB/wW9z10afTAOF/9nwOrCK/Lc4sFyDxCuzyVt6Z0snS296i86gLnyAELZQtLCLIDcb1dOBr0xnS19zR8MkIcR4bLC0uHiSSEKv4seJr1JjR9toQ7uAFJRwFK5gu7CVKE5f7DOWW1UXRO9lh6/ECvBnEKdMulCfvFYf+gufs1iHRp9fG6AAAOhdZKN8uFCl+GHkBEeps2C3RPNZE5g/9nxTFJrsuair0GmkEtuwU2mjR+9Tb4yD68BEKJWgulStPHVUHbu/i29PR5dOP4Tf3Lw8pI+ctlSyMHzoKOPLU3WzS/NJh31j0XgwlITctZy2qIRQND/Xp3zLTQdJU3YTxgQkAH1ksCy6lI+EP8fcf4ifUtNFr27/umwa7HE8rgS58JZ4S2/pz5EfVVdGm2QvsrgNZGhgqyC4uJ0gVy/3i5pPWJtEI2GvpvADcF7go4C64KNwXvABr6QjYJtGT1uLmy/1IFS4nyC4YKlkargML7KbZVdFH1XPk2/qeEnwlgS5PK7scmwa/7mvbtNEn1B/i8ffhD6UjCy5ZLAAfgQmE8VTdQdIy0+nfD/UUDaohZy03LSUhXgxY9GHf/NJs0tTdOPI6CowflSznLSkjLw8394/h5dPT0eLbbu9VB08dlStoLgol8BEg+tvj+9Ro0RTatuxpBPQaaiq7LsUmnxQP/UTmPNYt0WzYEep5AX4YFCnfLlkoOhcAAMbop9ch0ezWgueH/u8VlCfTLsQpvBnxAmHrO9lF0ZbVDOWX+0oT7CWYLgUrJRzgBRDu9tqY0WvUseKr+JIQHiQtLhsscR7JCNHw19wZ0mvTdODG9cgNLCKULQQtnyCoC6Lz297J0pnSVt7s8vEKFyDOLL8trCJ8Dn/2AOGn0/XRW9wf8A8I4R3ZK0wulSRBEWX5ReOx1H/RhNpi7SUFjRu5KqsuWib1E1L8p+Xo1TjR0ti46jUCHhltKdou+CeVFkT/JOhI1yDRSNck6ET/lRb4J9oubSkeGTUCuOrS2DjR6NWn5VL89RNaJqsuuSqNGyUFYu2E2n/RsdRF42X5QRGVJEwu2SvhHQ8IH/Bb3PXRp9MA4X/2fA6sIr8tziwXIPEK7PJW3pnSydLb3qLzqAufIAQtlC0sIsgNxvV04GvTGdLX3NHwyQhxHhssLS4eJJIQq/ix4mvUmNH22hDu4AUlHAUrmC7sJUoTl/sM5ZbVRdE72WHr8QK8GcQp0y6UJ+8Vh/6C5+zWIdGn18boAAA6F1ko3y4UKX4YeQER6mzYLdE81kTmD/2fFMUmuy5qKvQaaQS27BTaaNH71NvjIPrwEQolaC6VK08dVQdu7+Lb09Hl04/hN/cvDykj5y2VLIwfOgo48tTdbNL80mHfWPReDCUhNy1nLaohFA0P9enfMtNB0lTdhPGBCQAfWSwLLqUj4Q/x9x/iJ9S00Wvbv+6bBrscTyuBLnwlnhLb+nPkR9VV0abZC+yuA1kaGCrILi4nSBXL/eLmk9Ym0QjYa+m8ANwXuCjgLrgo3Be8AGvpCNgm0ZPW4ubL/UgVLifILhgqWRquAwvsptlV0UfVc+Tb+p4SfCWBLk8ruxybBr/ua9u00SfUH+Lx9+EPpSMLLlksAB+BCYTxVN1B0jLT6d8P9RQNqiFnLTctJSFeDFj0Yd/80mzS1N048joKjB8=';

export const BR_AUDIO_CUES = {
  WeaponFire: 'battle-royale.weapon.fire',
  WeaponReload: 'battle-royale.weapon.reload',
  PlayerHit: 'battle-royale.player.hit',
  PlayerEliminated: 'battle-royale.player.eliminated',
  ItemCollect: 'battle-royale.item.collect',
  ZoneWarning: 'battle-royale.zone.warning',
  MatchStart: 'battle-royale.match.start',
  MatchEnd: 'battle-royale.match.end',
  MenuMusic: 'battle-royale.shell.menu-music',
} as const;

export type BattleRoyaleAudioCueId = (typeof BR_AUDIO_CUES)[keyof typeof BR_AUDIO_CUES];

export type BattleRoyaleAudioEvent =
  | { readonly type: 'weapon.fire' }
  | { readonly type: 'weapon.reload' }
  | { readonly type: 'player.hit' }
  | { readonly type: 'player.eliminated' }
  | { readonly type: 'item.collect' }
  | { readonly type: 'environment.zoneWarning' }
  | { readonly type: 'match.start' }
  | { readonly type: 'match.end' };

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

export const battleRoyaleMusicBus: RuntimeAudioBusDefinition = {
  id: BR_MUSIC_BUS_ID,
  label: 'Battle Royale Music',
  kind: 'music',
  defaultVolume: 0.65,
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
  source: { url: BR_DEFAULT_AUDIO_DATA_URL, mime: 'audio/wav' },
});

const musicCue = (
  id: BattleRoyaleAudioCueId,
  label: string,
  defaultVolume: number,
): RuntimeAudioCueDefinition => ({
  id,
  label,
  busId: BR_MUSIC_BUS_ID,
  defaultVolume,
  source: { url: BR_DEFAULT_AUDIO_DATA_URL, mime: 'audio/wav' },
  loop: true,
  maxOverlap: 1,
});

export const battleRoyaleAudioCues: readonly RuntimeAudioCueDefinition[] = [
  { ...musicCue(BR_AUDIO_CUES.MenuMusic, 'Menu music', 0.55), binding: 'shell.menuMusic' },
  { ...cue(BR_AUDIO_CUES.WeaponFire, 'Weapon fire', 0.72), binding: 'weapon.fire' },
  { ...cue(BR_AUDIO_CUES.WeaponReload, 'Weapon reload', 0.62), binding: 'weapon.reload' },
  { ...cue(BR_AUDIO_CUES.PlayerHit, 'Player hit', 0.8), binding: 'player.hit' },
  {
    ...cue(BR_AUDIO_CUES.PlayerEliminated, 'Player eliminated', 0.88),
    binding: 'player.eliminated',
  },
  { ...cue(BR_AUDIO_CUES.ItemCollect, 'Item collect', 0.58), binding: 'item.collect' },
  {
    ...cue(BR_AUDIO_CUES.ZoneWarning, 'Zone warning', 0.76),
    binding: 'environment.zoneWarning',
  },
  { ...cue(BR_AUDIO_CUES.MatchStart, 'Match start', 0.65), binding: 'match.start' },
  { ...cue(BR_AUDIO_CUES.MatchEnd, 'Match end', 0.78), binding: 'match.end' },
];

export const buildBattleRoyaleAudioBusData = (): BattleRoyaleAudioContributionData => ({
  schemaVersion: 1,
  buses: [battleRoyaleMusicBus, battleRoyaleSfxBus],
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
    case 'item.collect':
      return BR_AUDIO_CUES.ItemCollect;
    case 'environment.zoneWarning':
      return BR_AUDIO_CUES.ZoneWarning;
    case 'match.start':
      return BR_AUDIO_CUES.MatchStart;
    case 'match.end':
      return BR_AUDIO_CUES.MatchEnd;
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
