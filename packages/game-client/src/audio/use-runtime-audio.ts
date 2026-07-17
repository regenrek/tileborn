import { useEffect, useRef } from 'react';
import { defaultRuntimeAudioSettings } from '@tileborne/runtime';

import type { AudioTabConfig } from '../components/audio-tab.js';
import {
  bindBrowserRuntimeAudioFocusState,
  createBrowserRuntimeAudioEngine,
  type RuntimeAudioPlaybackEngine,
} from './browser-audio-engine.js';

const audioTopologyKey = (audio: AudioTabConfig | undefined): string | undefined => {
  if (audio === undefined) {
    return undefined;
  }
  return JSON.stringify({
    buses: audio.buses.map((bus) => ({
      id: bus.id,
      kind: bus.kind,
      defaultVolume: bus.defaultVolume,
    })),
    cues: (audio.cues ?? []).map((cue) => ({
      id: cue.id,
      busId: cue.busId,
      defaultVolume: cue.defaultVolume,
    })),
  });
};

export const useRuntimeAudio = (
  audio: AudioTabConfig | undefined,
): RuntimeAudioPlaybackEngine | undefined => {
  const engineRef = useRef<RuntimeAudioPlaybackEngine | undefined>(undefined);
  const topologyKey = audioTopologyKey(audio);

  useEffect(() => {
    if (audio === undefined) {
      window.__tileborneRuntimeAudio = undefined;
      engineRef.current = undefined;
      return undefined;
    }

    const engine = (audio.engineFactory ?? createBrowserRuntimeAudioEngine)({
      buses: audio.buses,
      cues: audio.cues ?? [],
      settings: audio.settings,
    });
    engineRef.current = engine;
    window.__tileborneRuntimeAudio = engine;
    const unbindFocusState = bindBrowserRuntimeAudioFocusState(engine);
    return () => {
      unbindFocusState();
      if (window.__tileborneRuntimeAudio === engine) {
        window.__tileborneRuntimeAudio = undefined;
      }
      engine.dispose();
      if (engineRef.current === engine) {
        engineRef.current = undefined;
      }
    };
  }, [audio?.engineFactory, topologyKey]);

  useEffect(() => {
    engineRef.current?.setSettings(audio?.settings ?? defaultRuntimeAudioSettings());
  }, [audio?.settings]);

  return engineRef.current;
};
