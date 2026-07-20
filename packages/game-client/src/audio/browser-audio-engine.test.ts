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

const sourcedCue = {
  ...testCue,
  id: 'battle-royale.weapon.reload',
  label: 'Weapon reload',
  source: { url: 'assets/audio/reload.ogg', mime: 'audio/ogg' },
  maxOverlap: 1,
  loop: true,
};

class FakeAudioContext {
  currentTime = 1;
  state: AudioContextState = 'running';
  destination = {};
  readonly oscillatorStart = vi.fn();
  readonly oscillatorStop = vi.fn();
  readonly close = vi.fn(() => Promise.resolve());
  readonly resume = vi.fn(() => Promise.resolve());
  readonly gainNodes: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn> }> = [];

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
    const gain = {
      gain: { value: 0 },
      connect: vi.fn(),
    };
    this.gainNodes.push(gain);
    return gain;
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
      loop: false,
      maxOverlap: 8,
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

  it('plays packaged audio sources through client-side audio elements and can stop them', async () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const listeners: (() => void)[] = [];
    const created: {
      loop: boolean;
      volume: number;
      currentTime: number;
      paused: boolean;
      src: string;
      play: typeof play;
      pause: typeof pause;
      addEventListener: (type: 'ended', listener: () => void) => void;
    }[] = [];
    const engine = createBrowserRuntimeAudioEngine({
      buses: [testBus],
      cues: [sourcedCue],
      audioElementFactory: (sourceUrl) => {
        const player = {
          loop: false,
          volume: 0,
          currentTime: 5,
          paused: false,
          src: sourceUrl,
          play,
          pause,
          addEventListener: (_type: 'ended', listener: () => void) => listeners.push(listener),
        };
        created.push(player);
        return player;
      },
    });

    const resolved = engine.playCue(sourcedCue.id);
    await Promise.resolve();

    expect(resolved).toEqual(
      expect.objectContaining({
        cueId: sourcedCue.id,
        source: sourcedCue.source,
        loop: true,
        maxOverlap: 1,
      }),
    );
    expect(created[0]).toMatchObject({
      src: 'assets/audio/reload.ogg',
      loop: true,
      volume: 0.25,
    });
    expect(play).toHaveBeenCalledTimes(1);
    expect(engine.snapshot().activeSourceCount).toBe(1);

    engine.stopCue(sourcedCue.id);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(created[0]?.currentTime).toBe(0);
    expect(engine.snapshot().activeSourceCount).toBe(0);
  });

  it('enforces per-cue overlap limits for packaged audio sources', () => {
    const engine = createBrowserRuntimeAudioEngine({
      buses: [testBus],
      cues: [sourcedCue],
      audioElementFactory: (sourceUrl) => ({
        loop: false,
        volume: 0,
        currentTime: 0,
        paused: false,
        src: sourceUrl,
        play: () => Promise.resolve(),
        pause: vi.fn(),
        addEventListener: vi.fn(),
      }),
    });

    engine.playCue(sourcedCue.id);
    engine.playCue(sourcedCue.id);

    expect(engine.snapshot()).toEqual(
      expect.objectContaining({
        audiblePlayCount: 1,
        activeSourceCount: 1,
        lastError: `Audio cue "${sourcedCue.id}" hit overlap limit 1.`,
      }),
    );
  });

  it('resolves packaged path-only sources and fails closed for unresolved asset ids', () => {
    const play = vi.fn(() => Promise.resolve());
    const engine = createBrowserRuntimeAudioEngine({
      buses: [testBus],
      cues: [
        {
          ...testCue,
          id: 'battle-royale.item.collect',
          source: { path: 'packs/br/audio/collect.ogg', mime: 'audio/ogg' },
        },
        {
          ...testCue,
          id: 'battle-royale.player.hit',
          source: { assetId: 'asset:missing' },
        },
      ],
      audioElementFactory: (sourceUrl) => ({
        loop: false,
        volume: 0,
        currentTime: 0,
        paused: false,
        src: sourceUrl,
        play,
        pause: vi.fn(),
        addEventListener: vi.fn(),
      }),
      audioContextFactory: () => {
        throw new Error('synthetic fallback must not be used for unresolved packaged sources');
      },
    });

    engine.playCue('battle-royale.item.collect');
    expect(play).toHaveBeenCalledTimes(1);
    expect(engine.snapshot().lastResolved?.source).toEqual({
      path: 'packs/br/audio/collect.ogg',
      mime: 'audio/ogg',
    });

    engine.playCue('battle-royale.player.hit');
    expect(engine.snapshot()).toEqual(
      expect.objectContaining({
        unsupportedPlayCount: 1,
        lastError: 'Audio cue "battle-royale.player.hit" has no resolvable packaged source URL.',
      }),
    );
  });

  it('updates active source volume when live settings change and stops inaudible loops', () => {
    const pause = vi.fn();
    const created: {
      loop: boolean;
      volume: number;
      currentTime: number;
      paused: boolean;
      src: string;
      play: () => Promise<void>;
      pause: typeof pause;
      addEventListener: (type: 'ended', listener: () => void) => void;
    }[] = [];
    const engine = createBrowserRuntimeAudioEngine({
      buses: [testBus],
      cues: [sourcedCue],
      audioElementFactory: (sourceUrl) => {
        const player = {
          loop: false,
          volume: 0,
          currentTime: 7,
          paused: false,
          src: sourceUrl,
          play: () => Promise.resolve(),
          pause,
          addEventListener: vi.fn(),
        };
        created.push(player);
        return player;
      },
    });

    engine.playCue(sourcedCue.id);
    expect(created[0]?.volume).toBe(0.25);

    engine.setSettings({
      masterVolume: 0.5,
      muted: false,
      muteOnFocusLoss: true,
      busVolumes: { [testBus.id]: 0.5 },
    });
    expect(created[0]?.volume).toBe(0.125);

    engine.setFocusState('backgrounded');
    expect(pause).toHaveBeenCalledTimes(1);
    expect(created[0]?.currentTime).toBe(0);
    expect(engine.snapshot().activeSourceCount).toBe(0);
  });

  it('updates and stops synthetic players when settings change', () => {
    const context = new FakeAudioContext();
    const loopingSyntheticCue = { ...testCue, loop: true, maxOverlap: 1 };
    const engine = createBrowserRuntimeAudioEngine({
      buses: [testBus],
      cues: [loopingSyntheticCue],
      audioContextFactory: () => context as unknown as AudioContext,
    });

    engine.playCue(loopingSyntheticCue.id);
    engine.playCue(loopingSyntheticCue.id);

    expect(engine.snapshot()).toEqual(
      expect.objectContaining({
        audiblePlayCount: 1,
        activeSourceCount: 1,
        lastError: `Audio cue "${loopingSyntheticCue.id}" hit overlap limit 1.`,
      }),
    );
    expect(context.gainNodes[0]?.gain.value).toBe(0.25);

    engine.setSettings({
      masterVolume: 0.5,
      muted: false,
      muteOnFocusLoss: true,
      busVolumes: { [testBus.id]: 0.5 },
    });

    expect(context.gainNodes[0]?.gain.value).toBe(0.125);

    engine.setSettings({
      masterVolume: 1,
      muted: true,
      muteOnFocusLoss: true,
      busVolumes: { [testBus.id]: 1 },
    });

    expect(context.oscillatorStop).toHaveBeenCalled();
    expect(engine.snapshot().activeSourceCount).toBe(0);
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
