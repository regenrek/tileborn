import { useEffect, useRef, type RefObject } from 'react';
import type { PlaytestSessionId } from '@tileborne/services-build';
import {
  bindBrowserRuntimeAudioFocusState,
  createBrowserRuntimeAudioEngine,
} from '@tileborne/game-client';
import {
  defaultRuntimeAudioSettings,
  type RuntimeAudioBusDefinition,
  type RuntimeAudioCueDefinition,
  type RuntimeAudioSettings,
} from '@tileborne/runtime';

import { attachPlaytestInputCapture } from '@/lib/playtest-input';
import {
  dispatchRuntimeAudioEvent,
  resolvePlaytestPlugin,
} from '@/lib/playtest-plugin-bridge';

const LOCAL_PLAYER_INPUT_ID = 'player-1';

export type PlaytestViewportProjectAudio = {
  readonly buses: readonly RuntimeAudioBusDefinition[];
  readonly cues: readonly RuntimeAudioCueDefinition[];
  readonly settings: RuntimeAudioSettings;
};

export const usePlaytestInputBridge = ({
  containerRef,
  pluginId,
  sessionId,
  tickCount,
  projectAudio,
}: {
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly pluginId: string | undefined;
  readonly sessionId: string;
  readonly tickCount: number | undefined;
  readonly projectAudio: PlaytestViewportProjectAudio | undefined;
}) => {
  // The capture/resolver lifecycle MUST NOT depend on `tickCount`: a tick refresh
  // tearing down + recreating the resolver would drop held mouse/key state (a
  // held mouse has no repeat `mousedown`, so PrimaryAction/`shoot` would silently
  // clear on the next tick). Keep the latest tick in a ref the emit path reads so
  // outgoing frames carry the current tick without re-running the effect.
  const tickCountRef = useRef(tickCount);
  useEffect(() => {
    tickCountRef.current = tickCount;
  }, [tickCount]);

  useEffect(() => {
    if (pluginId === undefined) {
      return undefined;
    }
    // Remap-apply policy (ADR-0024): a keybind remap is persisted by the
    // Controls UI (a separate player-settings surface) to the shared overlay
    // store; the desktop playtest has no in-session Controls UI to wire a live
    // `handle.setEffectiveMap` to, so remaps apply on the NEXT playtest session.
    // `resolvePlaytestPlugin` reloads the LATEST persisted overlay every time
    // this effect (re)runs - i.e. on each capture-attach - so a session always
    // starts on the freshest saved bindings. The live `setEffectiveMap` seam
    // stays available for a future same-surface remap UI.
    const plugin = resolvePlaytestPlugin(pluginId);
    const audioBuses = [...(plugin.audio?.buses ?? []), ...(projectAudio?.buses ?? [])];
    const audioCues = [...(plugin.audio?.cues ?? []), ...(projectAudio?.cues ?? [])];
    const audioEngine =
      audioCues.length === 0
        ? undefined
        : createBrowserRuntimeAudioEngine({
            buses: audioBuses,
            cues: audioCues,
            settings: projectAudio?.settings ?? defaultRuntimeAudioSettings(),
          });
    const unbindAudioFocusState =
      audioEngine === undefined ? undefined : bindBrowserRuntimeAudioFocusState(audioEngine);
    if (audioEngine !== undefined) {
      window.__tilebornePlaytestAudio = audioEngine;
      dispatchRuntimeAudioEvent(audioEngine, audioCues, 'shell.menuMusic');
    }
    let seq = 0;

    const handle = attachPlaytestInputCapture({
      container: containerRef.current,
      inputMap: plugin.inputMap,
      controlScheme: plugin.controlScheme,
      profile: plugin.inputCaptureProfile,
      resolveIntent: plugin.resolveInputIntent,
      onIntent: (intent) => {
        seq += 1;
        const idle =
          intent.dir === undefined &&
          !intent.shoot &&
          !intent.reload &&
          !intent.interact &&
          !intent.drop &&
          intent.abilities.length === 0 &&
          intent.aimDeg === undefined &&
          intent.swapSlot === undefined;
        const payload = {
          sessionId: sessionId as PlaytestSessionId,
          playerId: LOCAL_PLAYER_INPUT_ID,
          tick: tickCountRef.current ?? 0,
          seq,
          ...(intent.dir === undefined ? {} : { dir: intent.dir }),
          shoot: intent.shoot,
          reload: intent.reload,
          interact: intent.interact,
          drop: intent.drop,
          abilities: [...intent.abilities],
          ...(intent.aimDeg === undefined ? {} : { aimDeg: intent.aimDeg }),
          ...(intent.swapSlot === undefined ? {} : { swapSlot: intent.swapSlot }),
          ...(idle ? { active: false } : {}),
        };
        void window.tileborne.runtime.playtestInput(payload);
      },
    });

    return () => {
      handle.dispose();
      unbindAudioFocusState?.();
      if (window.__tilebornePlaytestAudio === audioEngine) {
        window.__tilebornePlaytestAudio = undefined;
      }
      audioEngine?.dispose();
    };
  }, [containerRef, pluginId, projectAudio, sessionId]);
};

export function PlaytestInputBridgeProducer({
  container,
  pluginId,
  sessionId,
  tickCount,
  projectAudio,
}: {
  readonly container: HTMLElement;
  readonly pluginId: string | undefined;
  readonly sessionId: string;
  readonly tickCount: number | undefined;
  readonly projectAudio?: PlaytestViewportProjectAudio | undefined;
}) {
  const containerRef = useRef<HTMLElement | null>(container);
  useEffect(() => {
    containerRef.current = container;
  }, [container]);
  usePlaytestInputBridge({ containerRef, pluginId, sessionId, tickCount, projectAudio });
  return null;
}
