export interface VisualSize {
  readonly width: number;
  readonly height: number;
}

export interface VisualProofRequirement {
  readonly id: string;
  readonly description: string;
}

const PETWARS_REFERENCE_PLAYER_RADIUS = 18;
const TILEBORNE_BR_FIXED_ZOOM = 4;

export const BATTLE_ROYALE_VISUAL_ORACLE = {
  version: 'br-visual-oracle.v1',
  reference: {
    source: '/Users/kregenrek/projects/games/petwars',
    playerRadiusPx: PETWARS_REFERENCE_PLAYER_RADIUS,
    playerSourceStressFrame: { width: 192, height: 208 },
    pickupWorldSize: { width: 32, height: 32 },
    equippedWeaponWorldSize: { width: 44, height: 16 },
    weaponSourceCellSize: { width: 64, height: 64 },
  },
  render: {
    fixedZoom: TILEBORNE_BR_FIXED_ZOOM,
    playerWorldFootprint: {
      width: PETWARS_REFERENCE_PLAYER_RADIUS * 2,
      height: PETWARS_REFERENCE_PLAYER_RADIUS * 2,
    },
    maxPlayerScreenFootprint: { width: 176, height: 192 },
    maxNameplateFontPx: 13,
    rawPlayerIdNameplates: 'forbidden',
  },
  assets: {
    projectileWorldSize: { width: 24, height: 8 },
    pickupWorldSize: { width: 32, height: 32 },
    equippedWeaponWorldSize: { width: 44, height: 16 },
    mustBeDistinctAssetRoles: [
      'weapon-rifle',
      'projectile-bolt',
      'impact-burst',
      'shield-burst',
      'shadow',
      'loot-crate',
      'pickup',
    ],
  },
  playtestPresentation: {
    liveOverlayDefaults: {
      grid: false,
      collision: false,
      debug: false,
      minimap: true,
    },
    maxMinimapPx: 128,
  },
  liveProof: [
    {
      id: 'selected-player-model',
      description: 'The visible player sprite is the selected editor model, not a placeholder.',
    },
    {
      id: 'normalized-large-source-frame',
      description:
        'A large source frame renders at the normalized player footprint, not raw UV size.',
    },
    {
      id: 'authored-spawn',
      description:
        'The first live player starts at the authored spawn point used by the editor map.',
    },
    {
      id: 'shooting-vfx',
      description: 'Shoot input emits visible muzzle, projectile, and impact visuals.',
    },
    {
      id: 'no-raw-nameplate',
      description: 'No scaled world-space raw id label such as player-1 is visible by default.',
    },
    {
      id: 'hud-readable',
      description: 'HUD, minimap, and overlays do not occlude the local player or shooting lane.',
    },
  ] satisfies readonly VisualProofRequirement[],
} as const;

export const projectVisualSize = (size: VisualSize, fixedZoom: number): VisualSize => ({
  width: size.width * fixedZoom,
  height: size.height * fixedZoom,
});

export const exceedsSize = (candidate: VisualSize, limit: VisualSize): boolean =>
  candidate.width > limit.width || candidate.height > limit.height;

export const isRawPlayerIdNameplate = (value: string): boolean =>
  /^player-\d+$/u.test(value.trim());

export const hasEveryVisualProofRequirement = (ids: ReadonlySet<string>): boolean =>
  BATTLE_ROYALE_VISUAL_ORACLE.liveProof.every((requirement) => ids.has(requirement.id));
