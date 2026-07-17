import { describe, expect, it } from 'vitest';

import {
  BATTLE_ROYALE_VISUAL_ORACLE,
  exceedsSize,
  hasEveryVisualProofRequirement,
  isRawPlayerIdNameplate,
  projectVisualSize,
} from './visual-oracle.js';

describe('BATTLE_ROYALE_VISUAL_ORACLE', () => {
  it('captures the large-source-frame regression without accepting raw UV display size', () => {
    const fixedZoom = BATTLE_ROYALE_VISUAL_ORACLE.render.fixedZoom;
    const rawSourceFrame = projectVisualSize(
      BATTLE_ROYALE_VISUAL_ORACLE.reference.playerSourceStressFrame,
      fixedZoom,
    );
    const normalizedFootprint = projectVisualSize(
      BATTLE_ROYALE_VISUAL_ORACLE.render.playerWorldFootprint,
      fixedZoom,
    );

    expect(
      exceedsSize(rawSourceFrame, BATTLE_ROYALE_VISUAL_ORACLE.render.maxPlayerScreenFootprint),
    ).toBe(true);
    expect(
      exceedsSize(normalizedFootprint, BATTLE_ROYALE_VISUAL_ORACLE.render.maxPlayerScreenFootprint),
    ).toBe(false);
  });

  it('forbids raw player id labels as production nameplates', () => {
    expect(BATTLE_ROYALE_VISUAL_ORACLE.render.rawPlayerIdNameplates).toBe('forbidden');
    expect(isRawPlayerIdNameplate('player-1')).toBe(true);
    expect(isRawPlayerIdNameplate('Player 1')).toBe(false);
    expect(isRawPlayerIdNameplate('Vanguard')).toBe(false);
  });

  it('requires distinct visual roles and production playtest overlay defaults', () => {
    expect(BATTLE_ROYALE_VISUAL_ORACLE.assets.mustBeDistinctAssetRoles).toEqual(
      expect.arrayContaining([
        'weapon-rifle',
        'projectile-bolt',
        'impact-burst',
        'shield-burst',
        'shadow',
      ]),
    );
    expect(BATTLE_ROYALE_VISUAL_ORACLE.playtestPresentation.liveOverlayDefaults).toEqual({
      grid: false,
      collision: false,
      debug: false,
      minimap: true,
    });
  });

  it('defines the live proof scorecard for screenshot-class defects', () => {
    const ids = new Set(BATTLE_ROYALE_VISUAL_ORACLE.liveProof.map((requirement) => requirement.id));

    expect(hasEveryVisualProofRequirement(ids)).toBe(true);
    expect(ids).toEqual(
      new Set([
        'selected-player-model',
        'normalized-large-source-frame',
        'authored-spawn',
        'shooting-vfx',
        'no-raw-nameplate',
        'hud-readable',
      ]),
    );
  });
});
