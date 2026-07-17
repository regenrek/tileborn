import { describe, expect, it, vi } from 'vitest';

import {
  bindBrowserRuntimeAudioFocusState,
  createBrowserRuntimeAudioEngine,
} from './browser-audio-engine.js';

const testBus = {
  id: 'battle-royale.sfx',
  label: 'Battle Royale SFX',
  kind: 'sfx' as const,
  defaultVolume: 0.5,
};

const testCue = {
  id: 'battle-royale.weapon.fire',
  label: 'Weapon fire',
  busId: testBus.id,
  defaultVolume: 0.5,
};

class FakeAudioContext {
  currentTime = 1;
  state: AudioContextState = 'running';
  destination = {};
  readonly oscillatorStart = vi.fn();
  readonly oscillatorStop = vi.fn();
  readonly close = vi.fn(() => Promise.resolve());
  readonly resume = vi.fn(() => Promise.resolve());

  createOscillator() {
    return {
      type: 'sine' as OscillatorType,
      frequency: { value: 0 },
      connect: vi.fn(),
      start: this.oscillatorStart,
      stop: this.oscillatorStop,
    };
  }

  createGain() {
    return {
      gain: { value: 0 },
      connect: vi.fn(),
    };
  }
}

describe('browser runtime audio engine', () => {
  it('consumes mixer settings to produce audible WebAudio playback', () => {
    const context = new FakeAudioContext();
    const engine = createBrowserRuntimeAudioEngine({
      buses: [testBus],
      cues: [testCue],
      settings: {
        masterVolume: 0.8,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: { [testBus.id]: 0.25 },
      },
      audioContextFactory: () => context as unknown as AudioContext,
    });

    const resolved = engine.playCue(testCue.id);

    expect(resolved).toEqual({
      cueId: testCue.id,
      busId: testBus.id,
      gain: 0.1,
      audible: true,
    });
    expect(context.oscillatorStart).toHaveBeenCalledWith(1);
    expect(context.oscillatorStop).toHaveBeenCalledWith(1.075);
    expect(engine.snapshot()).toEqual(
      expect.objectContaining({
        supported: true,
        playCount: 1,
        audiblePlayCount: 1,
        lastRequest: { cueId: testCue.id },
        lastResolved: expect.objectContaining({ audible: true, gain: 0.1 }),
      }),
    );
  });

  it('applies mute and focus-loss policy before touching WebAudio', () => {
    const context = new FakeAudioContext();
    const engine = createBrowserRuntimeAudioEngine({
      buses: [testBus],
      cues: [testCue],
      audioContextFactory: () => context as unknown as AudioContext,
    });

    engine.setSettings({
      masterVolume: 1,
      muted: true,
      muteOnFocusLoss: true,
      busVolumes: { [testBus.id]: 1 },
    });
    expect(engine.playCue(testCue.id)).toEqual(
      expect.objectContaining({ audible: false, mutedReason: 'master-muted' }),
    );

    engine.setSettings({
      masterVolume: 1,
      muted: false,
      muteOnFocusLoss: true,
      busVolumes: { [testBus.id]: 1 },
    });
    engine.setFocusState('backgrounded');
    expect(engine.playCue(testCue.id)).toEqual(
      expect.objectContaining({ audible: false, mutedReason: 'focus-muted' }),
    );

    expect(context.oscillatorStart).not.toHaveBeenCalled();
    expect(engine.snapshot()).toEqual(
      expect.objectContaining({
        playCount: 2,
        audiblePlayCount: 0,
        focusState: 'backgrounded',
      }),
    );
  });

  it('binds browser focus events into the engine focus state', () => {
    const engine = createBrowserRuntimeAudioEngine({ buses: [testBus], cues: [testCue] });
    const unbind = bindBrowserRuntimeAudioFocusState(engine);

    window.dispatchEvent(new Event('blur'));
    expect(engine.snapshot().focusState).toBe('backgrounded');

    window.dispatchEvent(new Event('focus'));
    expect(engine.snapshot().focusState).toBe('focused');

    unbind();
  });
});
