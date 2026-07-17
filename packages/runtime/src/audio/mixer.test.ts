import { describe, expect, it } from 'vitest';

import {
  defaultRuntimeAudioSettings,
  resolveAudioBusGain,
  resolveAudioCuePlayback,
  type RuntimeAudioBusDefinition,
  type RuntimeAudioCueDefinition,
} from './mixer.js';

const sfxBus: RuntimeAudioBusDefinition = {
  id: 'game.sfx',
  label: 'Game SFX',
  kind: 'sfx',
  defaultVolume: 0.8,
};

const fireCue: RuntimeAudioCueDefinition = {
  id: 'game.weapon.fire',
  label: 'Weapon fire',
  busId: sfxBus.id,
  defaultVolume: 0.5,
};

describe('runtime audio mixer', () => {
  it('combines master, bus, cue, and request volume into deterministic gain', () => {
    const playback = resolveAudioCuePlayback(
      fireCue,
      sfxBus,
      {
        ...defaultRuntimeAudioSettings(),
        masterVolume: 0.75,
        busVolumes: { [sfxBus.id]: 0.4 },
      },
      'focused',
      0.5,
    );

    expect(playback).toMatchObject({
      cueId: fireCue.id,
      busId: sfxBus.id,
      audible: true,
    });
    expect(playback.gain).toBeCloseTo(0.075);
  });

  it('applies explicit mute before bus/cue gain', () => {
    const playback = resolveAudioCuePlayback(
      fireCue,
      sfxBus,
      { ...defaultRuntimeAudioSettings(), muted: true },
      'focused',
    );

    expect(playback.gain).toBe(0);
    expect(playback.audible).toBe(false);
    expect(playback.mutedReason).toBe('master-muted');
  });

  it('mutes background playback when focus policy requires it', () => {
    const busGain = resolveAudioBusGain(sfxBus, defaultRuntimeAudioSettings(), 'backgrounded');

    expect(busGain).toEqual({ gain: 0, mutedReason: 'focus-muted' });
  });

  it('allows background playback when focus muting is disabled', () => {
    const busGain = resolveAudioBusGain(
      sfxBus,
      { ...defaultRuntimeAudioSettings(), muteOnFocusLoss: false },
      'backgrounded',
    );

    expect(busGain).toEqual({ gain: 0.8 });
  });

  it('rejects a cue resolved against the wrong bus', () => {
    expect(() =>
      resolveAudioCuePlayback(
        fireCue,
        { id: 'game.music', label: 'Music', kind: 'music', defaultVolume: 1 },
        defaultRuntimeAudioSettings(),
        'focused',
      ),
    ).toThrow(/targets bus/);
  });
});
