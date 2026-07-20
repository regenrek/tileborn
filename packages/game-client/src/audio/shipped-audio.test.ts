import { describe, expect, it, vi } from 'vitest';

import {
  createBrowserRuntimeAudioEngine,
  type RuntimeAudioElement,
} from './browser-audio-engine.js';
import { decodeShippedAudioConfig, loadShippedAudioConfig } from './shipped-audio.js';

const audioElement =
  (openedUrls: string[]) =>
  (sourceUrl: string): RuntimeAudioElement => {
    openedUrls.push(sourceUrl);
    return {
      loop: false,
      volume: 0,
      currentTime: 0,
      paused: true,
      src: '',
      play: vi.fn(),
      pause: vi.fn(),
      addEventListener: vi.fn(),
    };
  };

describe('shipped audio bootstrap', () => {
  it('decodes audio.json and opens copied map-package asset URLs through the browser adapter', () => {
    const audio = decodeShippedAudioConfig(
      {
        buses: [{ id: 'project.music', label: 'Project Music', kind: 'music', defaultVolume: 0.8 }],
        cues: [
          {
            id: 'project.shell.menuMusic',
            label: 'Menu Loop',
            busId: 'project.music',
            defaultVolume: 1,
            binding: 'shell.menuMusic',
            classification: 'music',
            source: { url: 'assets/packs/pack-a-1.0.0/audio/menu.ogg', mime: 'audio/ogg' },
            loop: true,
            maxOverlap: 1,
          },
        ],
        settings: {
          masterVolume: 0.5,
          muted: false,
          muteOnFocusLoss: true,
          busVolumes: { 'project.music': 0.25 },
        },
      },
      { sourceUrlBase: 'maps/map-fixture', onChange: vi.fn() },
    );
    expect(audio).toBeDefined();

    const openedUrls: string[] = [];
    const engine = createBrowserRuntimeAudioEngine({
      buses: audio?.buses ?? [],
      cues: audio?.cues ?? [],
      settings: audio?.settings,
      audioElementFactory: audioElement(openedUrls),
    });

    const resolved = engine.playCue('project.shell.menuMusic');

    expect(resolved?.source?.url).toBe('maps/map-fixture/assets/packs/pack-a-1.0.0/audio/menu.ogg');
    expect(openedUrls).toEqual(['maps/map-fixture/assets/packs/pack-a-1.0.0/audio/menu.ogg']);
    expect(engine.snapshot().settings.busVolumes?.['project.music']).toBe(0.25);
  });

  it('recovers from malformed audio.json without rejecting app bootstrap', async () => {
    const loaded = await loadShippedAudioConfig({
      mapId: 'map:fixture',
      onChange: vi.fn(),
      fetchImpl: vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => {
              throw new Error('bad json');
            },
          }) as Response,
      ),
    });

    expect(loaded).toBeUndefined();
  });
});
