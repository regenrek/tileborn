import {
  defaultRuntimeAudioSettings,
  resolveAudioCuePlayback,
  type ResolvedAudioPlayback,
  type RuntimeAudioBusDefinition,
  type RuntimeAudioCueDefinition,
  type RuntimeAudioFocusState,
  type RuntimeAudioSettings,
} from '@tileborne/runtime';

export interface RuntimeAudioCueRequest {
  readonly cueId: string;
  readonly volume?: number;
}

export interface RuntimeAudioEngineSnapshot {
  readonly supported: boolean;
  readonly focusState: RuntimeAudioFocusState;
  readonly settings: RuntimeAudioSettings;
  readonly playCount: number;
  readonly audiblePlayCount: number;
  readonly unsupportedPlayCount: number;
  readonly activeSourceCount: number;
  readonly lastRequest?: RuntimeAudioCueRequest | undefined;
  readonly lastResolved?: ResolvedAudioPlayback | undefined;
  readonly lastError?: string | undefined;
}

export interface RuntimeAudioPlaybackEngine {
  readonly playCue: (request: RuntimeAudioCueRequest | string) => ResolvedAudioPlayback | undefined;
  readonly stopCue: (cueId: string) => void;
  readonly stopAll: () => void;
  readonly setSettings: (settings: RuntimeAudioSettings) => void;
  readonly setFocusState: (focusState: RuntimeAudioFocusState) => void;
  readonly snapshot: () => RuntimeAudioEngineSnapshot;
  readonly dispose: () => void;
}

export interface RuntimeAudioElement {
  loop: boolean;
  volume: number;
  currentTime: number;
  readonly paused: boolean;
  src: string;
  play: () => Promise<void> | void;
  pause: () => void;
  addEventListener: (
    type: 'ended',
    listener: () => void,
    options?: AddEventListenerOptions,
  ) => void;
}

export interface BrowserRuntimeAudioEngineConfig {
  readonly buses: readonly RuntimeAudioBusDefinition[];
  readonly cues: readonly RuntimeAudioCueDefinition[];
  readonly settings?: RuntimeAudioSettings | undefined;
  readonly audioContextFactory?: (() => AudioContext) | undefined;
  readonly audioElementFactory?: ((sourceUrl: string) => RuntimeAudioElement) | undefined;
  readonly sourceUrlResolver?:
    | ((source: NonNullable<RuntimeAudioCueDefinition['source']>) => string | undefined)
    | undefined;
}

type AudioContextConstructor = new () => AudioContext;

const webAudioContextConstructor = (): AudioContextConstructor | undefined => {
  const candidate = globalThis as typeof globalThis & {
    readonly webkitAudioContext?: AudioContextConstructor | undefined;
  };
  return candidate.AudioContext ?? candidate.webkitAudioContext;
};

const requestFrom = (request: RuntimeAudioCueRequest | string): RuntimeAudioCueRequest =>
  typeof request === 'string' ? { cueId: request } : request;

const cueFrequency = (cueId: string): number => {
  let hash = 0;
  for (let index = 0; index < cueId.length; index += 1) {
    hash = (hash * 31 + cueId.charCodeAt(index)) % 997;
  }
  return 180 + (hash % 620);
};

const playSyntheticCue = (
  context: AudioContext,
  cueId: string,
  gainValue: number,
  loop: boolean,
  onEnded: (player: ActiveSyntheticPlayer) => void,
): ActiveSyntheticPlayer => {
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = cueFrequency(cueId);
  gain.gain.value = gainValue;
  oscillator.connect(gain);
  gain.connect(context.destination);
  const player: ActiveSyntheticPlayer = {
    loop,
    setGain: (nextGain) => {
      gain.gain.value = nextGain;
    },
    stop: () => {
      try {
        oscillator.stop();
      } catch {
        // Oscillator was already stopped by its scheduled end.
      }
    },
  };
  if ('addEventListener' in oscillator) {
    oscillator.addEventListener('ended', () => onEnded(player), { once: true });
  }
  oscillator.start(now);
  oscillator.stop(loop ? now + 3_600 : now + 0.075);
  return player;
};

interface ActiveSyntheticPlayer {
  readonly stop: () => void;
  readonly setGain: (gain: number) => void;
  readonly loop: boolean;
}

export const createBrowserRuntimeAudioEngine = ({
  buses,
  cues,
  settings = defaultRuntimeAudioSettings(),
  audioContextFactory,
  audioElementFactory,
  sourceUrlResolver,
}: BrowserRuntimeAudioEngineConfig): RuntimeAudioPlaybackEngine => {
  const busById = new Map(buses.map((bus) => [bus.id, bus] as const));
  const cueById = new Map(cues.map((cue) => [cue.id, cue] as const));
  let currentSettings = settings;
  let focusState: RuntimeAudioFocusState = 'focused';
  let context: AudioContext | undefined;
  let contextSupported = true;
  let playCount = 0;
  let audiblePlayCount = 0;
  let unsupportedPlayCount = 0;
  let lastRequest: RuntimeAudioCueRequest | undefined;
  let lastResolved: ResolvedAudioPlayback | undefined;
  let lastError: string | undefined;
  const activeSourcePlayersByCue = new Map<string, RuntimeAudioElement[]>();
  const activeSyntheticPlayersByCue = new Map<string, ActiveSyntheticPlayer[]>();

  const createAudioElement =
    audioElementFactory ??
    ((sourceUrl: string): RuntimeAudioElement => {
      const audio = new Audio(sourceUrl);
      return audio;
    });

  const activeSourceCount = (): number =>
    [...activeSourcePlayersByCue.values()].reduce((total, players) => total + players.length, 0) +
    [...activeSyntheticPlayersByCue.values()].reduce((total, players) => total + players.length, 0);

  const removeSourcePlayer = (cueId: string, player: RuntimeAudioElement): void => {
    const active = activeSourcePlayersByCue.get(cueId);
    if (active === undefined) return;
    const next = active.filter((candidate) => candidate !== player);
    if (next.length === 0) activeSourcePlayersByCue.delete(cueId);
    else activeSourcePlayersByCue.set(cueId, next);
  };

  const stopSourcePlayers = (cueId: string): void => {
    const active = activeSourcePlayersByCue.get(cueId) ?? [];
    for (const player of active) {
      player.pause();
      player.currentTime = 0;
    }
    activeSourcePlayersByCue.delete(cueId);
  };

  const stopAllSourcePlayers = (): void => {
    for (const cueId of activeSourcePlayersByCue.keys()) {
      stopSourcePlayers(cueId);
    }
  };

  const removeSyntheticPlayer = (cueId: string, player: ActiveSyntheticPlayer): void => {
    const active = activeSyntheticPlayersByCue.get(cueId);
    if (active === undefined) return;
    const next = active.filter((candidate) => candidate !== player);
    if (next.length === 0) activeSyntheticPlayersByCue.delete(cueId);
    else activeSyntheticPlayersByCue.set(cueId, next);
  };

  const stopSyntheticPlayers = (cueId: string): void => {
    const active = activeSyntheticPlayersByCue.get(cueId) ?? [];
    for (const player of active) player.stop();
    activeSyntheticPlayersByCue.delete(cueId);
  };

  const stopAllSyntheticPlayers = (): void => {
    for (const cueId of activeSyntheticPlayersByCue.keys()) stopSyntheticPlayers(cueId);
  };

  const stopInaudibleLoops = (): void => {
    for (const cueId of activeSourcePlayersByCue.keys()) {
      const cue = cueById.get(cueId);
      const bus = cue === undefined ? undefined : busById.get(cue.busId);
      if (cue?.loop === true && bus !== undefined) {
        const resolved = resolveAudioCuePlayback(cue, bus, currentSettings, focusState);
        if (!resolved.audible) stopSourcePlayers(cueId);
      }
    }
    for (const [cueId, players] of activeSyntheticPlayersByCue) {
      const cue = cueById.get(cueId);
      const bus = cue === undefined ? undefined : busById.get(cue.busId);
      if (players.some((player) => player.loop) && bus !== undefined && cue !== undefined) {
        const resolved = resolveAudioCuePlayback(cue, bus, currentSettings, focusState);
        if (!resolved.audible) stopSyntheticPlayers(cueId);
      }
    }
  };

  const applyLiveSettingsToSourcePlayers = (): void => {
    for (const [cueId, players] of activeSourcePlayersByCue) {
      const cue = cueById.get(cueId);
      const bus = cue === undefined ? undefined : busById.get(cue.busId);
      if (cue === undefined || bus === undefined) continue;
      const resolved = resolveAudioCuePlayback(cue, bus, currentSettings, focusState);
      for (const player of players) player.volume = resolved.gain;
      if (cue.loop === true && !resolved.audible) stopSourcePlayers(cueId);
    }
  };

  const applyLiveSettingsToSyntheticPlayers = (): void => {
    for (const [cueId, players] of activeSyntheticPlayersByCue) {
      const cue = cueById.get(cueId);
      const bus = cue === undefined ? undefined : busById.get(cue.busId);
      if (cue === undefined || bus === undefined) continue;
      const resolved = resolveAudioCuePlayback(cue, bus, currentSettings, focusState);
      for (const player of players) player.setGain(resolved.gain);
      if (cue.loop === true && !resolved.audible) stopSyntheticPlayers(cueId);
    }
  };

  const ensureContext = (): AudioContext | undefined => {
    if (context !== undefined) {
      return context;
    }
    const create =
      audioContextFactory ??
      (() => {
        const Context = webAudioContextConstructor();
        if (Context === undefined) {
          throw new Error('Web Audio API is unavailable.');
        }
        return new Context();
      });
    try {
      context = create();
      contextSupported = true;
      lastError = undefined;
      return context;
    } catch (error) {
      contextSupported = false;
      lastError = error instanceof Error ? error.message : 'Web Audio API is unavailable.';
      return undefined;
    }
  };

  return {
    playCue(requestInput) {
      const request = requestFrom(requestInput);
      playCount += 1;
      lastRequest = request;

      const cue = cueById.get(request.cueId);
      if (cue === undefined) {
        lastError = `Audio cue "${request.cueId}" is not registered.`;
        lastResolved = undefined;
        return undefined;
      }
      const bus = busById.get(cue.busId);
      if (bus === undefined) {
        lastError = `Audio bus "${cue.busId}" is not registered.`;
        lastResolved = undefined;
        return undefined;
      }

      const resolved = resolveAudioCuePlayback(
        cue,
        bus,
        currentSettings,
        focusState,
        request.volume ?? 1,
      );
      lastResolved = resolved;
      lastError = undefined;
      if (!resolved.audible) {
        return resolved;
      }

      const sourceUrl =
        resolved.source?.url ??
        (resolved.source?.path === undefined
          ? undefined
          : resolved.source.path.startsWith('assets/')
            ? resolved.source.path
            : `assets/${resolved.source.path}`) ??
        (resolved.source === undefined ? undefined : sourceUrlResolver?.(resolved.source));
      if (resolved.source !== undefined && sourceUrl === undefined) {
        unsupportedPlayCount += 1;
        lastError = `Audio cue "${resolved.cueId}" has no resolvable packaged source URL.`;
        return resolved;
      }
      if (sourceUrl !== undefined) {
        const currentPlayers = activeSourcePlayersByCue.get(resolved.cueId) ?? [];
        if (currentPlayers.length >= resolved.maxOverlap) {
          lastError = `Audio cue "${resolved.cueId}" hit overlap limit ${resolved.maxOverlap}.`;
          return resolved;
        }
        const player = createAudioElement(sourceUrl);
        player.loop = resolved.loop;
        player.volume = resolved.gain;
        player.src = sourceUrl;
        player.addEventListener('ended', () => removeSourcePlayer(resolved.cueId, player), {
          once: true,
        });
        activeSourcePlayersByCue.set(resolved.cueId, [...currentPlayers, player]);
        const playResult = player.play();
        if (playResult !== undefined && typeof playResult.catch === 'function') {
          void playResult.catch((error: unknown) => {
            removeSourcePlayer(resolved.cueId, player);
            unsupportedPlayCount += 1;
            lastError = error instanceof Error ? error.message : 'Audio element playback failed.';
          });
        }
        audiblePlayCount += 1;
        return resolved;
      }

      const activeContext = ensureContext();
      if (activeContext === undefined) {
        unsupportedPlayCount += 1;
        return resolved;
      }
      const currentSyntheticPlayers = activeSyntheticPlayersByCue.get(resolved.cueId) ?? [];
      if (currentSyntheticPlayers.length >= resolved.maxOverlap) {
        lastError = `Audio cue "${resolved.cueId}" hit overlap limit ${resolved.maxOverlap}.`;
        return resolved;
      }
      if (activeContext.state === 'suspended') {
        void activeContext.resume().catch((error: unknown) => {
          lastError = error instanceof Error ? error.message : 'Audio context resume failed.';
        });
      }
      const syntheticPlayer = playSyntheticCue(
        activeContext,
        resolved.cueId,
        resolved.gain,
        resolved.loop,
        (player) => removeSyntheticPlayer(resolved.cueId, player),
      );
      activeSyntheticPlayersByCue.set(resolved.cueId, [
        ...currentSyntheticPlayers,
        syntheticPlayer,
      ]);
      audiblePlayCount += 1;
      return resolved;
    },
    setSettings(nextSettings) {
      currentSettings = nextSettings;
      applyLiveSettingsToSourcePlayers();
      applyLiveSettingsToSyntheticPlayers();
      stopInaudibleLoops();
    },
    stopCue(cueId) {
      stopSourcePlayers(cueId);
      stopSyntheticPlayers(cueId);
    },
    stopAll() {
      stopAllSourcePlayers();
      stopAllSyntheticPlayers();
    },
    setFocusState(nextFocusState) {
      focusState = nextFocusState;
      applyLiveSettingsToSourcePlayers();
      applyLiveSettingsToSyntheticPlayers();
      stopInaudibleLoops();
    },
    snapshot() {
      return {
        supported: contextSupported,
        focusState,
        settings: currentSettings,
        playCount,
        audiblePlayCount,
        unsupportedPlayCount,
        activeSourceCount: activeSourceCount(),
        ...(lastRequest === undefined ? {} : { lastRequest }),
        ...(lastResolved === undefined ? {} : { lastResolved }),
        ...(lastError === undefined ? {} : { lastError }),
      };
    },
    dispose() {
      stopAllSourcePlayers();
      stopAllSyntheticPlayers();
      const activeContext = context;
      context = undefined;
      if (activeContext !== undefined && activeContext.state !== 'closed') {
        void activeContext.close().catch((error: unknown) => {
          lastError = error instanceof Error ? error.message : 'Audio context close failed.';
        });
      }
    },
  };
};

export const bindBrowserRuntimeAudioFocusState = (
  engine: RuntimeAudioPlaybackEngine,
  targetWindow: Window = window,
): (() => void) => {
  const updateFocusState = () => {
    const hidden = targetWindow.document.visibilityState === 'hidden';
    engine.setFocusState(hidden ? 'backgrounded' : 'focused');
  };
  const onBlur = () => engine.setFocusState('backgrounded');
  const onFocus = updateFocusState;

  updateFocusState();
  targetWindow.addEventListener('blur', onBlur);
  targetWindow.addEventListener('focus', onFocus);
  targetWindow.document.addEventListener('visibilitychange', updateFocusState);
  return () => {
    targetWindow.removeEventListener('blur', onBlur);
    targetWindow.removeEventListener('focus', onFocus);
    targetWindow.document.removeEventListener('visibilitychange', updateFocusState);
  };
};

declare global {
  interface Window {
    __tileborneRuntimeAudio?: RuntimeAudioPlaybackEngine | undefined;
    __tilebornePlaytestAudio?: RuntimeAudioPlaybackEngine | undefined;
  }
}
