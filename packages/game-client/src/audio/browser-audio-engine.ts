import {
  defaultRuntimeAudioSettings,
  resolveAudioCuePlayback,
  type ResolvedAudioPlayback,
  type RuntimeAudioBusDefinition,
  type RuntimeAudioCueDefinition,
  type RuntimeAudioFocusState,
  type RuntimeAudioSettings,
} from "@tileborne/runtime";

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
  readonly lastRequest?: RuntimeAudioCueRequest | undefined;
  readonly lastResolved?: ResolvedAudioPlayback | undefined;
  readonly lastError?: string | undefined;
}

export interface RuntimeAudioPlaybackEngine {
  readonly playCue: (request: RuntimeAudioCueRequest | string) => ResolvedAudioPlayback | undefined;
  readonly setSettings: (settings: RuntimeAudioSettings) => void;
  readonly setFocusState: (focusState: RuntimeAudioFocusState) => void;
  readonly snapshot: () => RuntimeAudioEngineSnapshot;
  readonly dispose: () => void;
}

export interface BrowserRuntimeAudioEngineConfig {
  readonly buses: readonly RuntimeAudioBusDefinition[];
  readonly cues: readonly RuntimeAudioCueDefinition[];
  readonly settings?: RuntimeAudioSettings | undefined;
  readonly audioContextFactory?: (() => AudioContext) | undefined;
}

type AudioContextConstructor = new () => AudioContext;

const webAudioContextConstructor = (): AudioContextConstructor | undefined => {
  const candidate = globalThis as typeof globalThis & {
    readonly webkitAudioContext?: AudioContextConstructor | undefined;
  };
  return candidate.AudioContext ?? candidate.webkitAudioContext;
};

const requestFrom = (request: RuntimeAudioCueRequest | string): RuntimeAudioCueRequest =>
  typeof request === "string" ? { cueId: request } : request;

const cueFrequency = (cueId: string): number => {
  let hash = 0;
  for (let index = 0; index < cueId.length; index += 1) {
    hash = (hash * 31 + cueId.charCodeAt(index)) % 997;
  }
  return 180 + (hash % 620);
};

const playSyntheticCue = (context: AudioContext, cueId: string, gainValue: number): void => {
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = cueFrequency(cueId);
  gain.gain.value = gainValue;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.075);
};

export const createBrowserRuntimeAudioEngine = ({
  buses,
  cues,
  settings = defaultRuntimeAudioSettings(),
  audioContextFactory,
}: BrowserRuntimeAudioEngineConfig): RuntimeAudioPlaybackEngine => {
  const busById = new Map(buses.map((bus) => [bus.id, bus] as const));
  const cueById = new Map(cues.map((cue) => [cue.id, cue] as const));
  let currentSettings = settings;
  let focusState: RuntimeAudioFocusState = "focused";
  let context: AudioContext | undefined;
  let contextSupported = true;
  let playCount = 0;
  let audiblePlayCount = 0;
  let unsupportedPlayCount = 0;
  let lastRequest: RuntimeAudioCueRequest | undefined;
  let lastResolved: ResolvedAudioPlayback | undefined;
  let lastError: string | undefined;

  const ensureContext = (): AudioContext | undefined => {
    if (context !== undefined) {
      return context;
    }
    const create = audioContextFactory ?? (() => {
      const Context = webAudioContextConstructor();
      if (Context === undefined) {
        throw new Error("Web Audio API is unavailable.");
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
      lastError = error instanceof Error ? error.message : "Web Audio API is unavailable.";
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

      const activeContext = ensureContext();
      if (activeContext === undefined) {
        unsupportedPlayCount += 1;
        return resolved;
      }
      if (activeContext.state === "suspended") {
        void activeContext.resume().catch((error: unknown) => {
          lastError = error instanceof Error ? error.message : "Audio context resume failed.";
        });
      }
      playSyntheticCue(activeContext, resolved.cueId, resolved.gain);
      audiblePlayCount += 1;
      return resolved;
    },
    setSettings(nextSettings) {
      currentSettings = nextSettings;
    },
    setFocusState(nextFocusState) {
      focusState = nextFocusState;
    },
    snapshot() {
      return {
        supported: contextSupported,
        focusState,
        settings: currentSettings,
        playCount,
        audiblePlayCount,
        unsupportedPlayCount,
        ...(lastRequest === undefined ? {} : { lastRequest }),
        ...(lastResolved === undefined ? {} : { lastResolved }),
        ...(lastError === undefined ? {} : { lastError }),
      };
    },
    dispose() {
      const activeContext = context;
      context = undefined;
      if (activeContext !== undefined && activeContext.state !== "closed") {
        void activeContext.close().catch((error: unknown) => {
          lastError = error instanceof Error ? error.message : "Audio context close failed.";
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
    const hidden = targetWindow.document.visibilityState === "hidden";
    engine.setFocusState(hidden ? "backgrounded" : "focused");
  };
  const onBlur = () => engine.setFocusState("backgrounded");
  const onFocus = updateFocusState;

  updateFocusState();
  targetWindow.addEventListener("blur", onBlur);
  targetWindow.addEventListener("focus", onFocus);
  targetWindow.document.addEventListener("visibilitychange", updateFocusState);
  return () => {
    targetWindow.removeEventListener("blur", onBlur);
    targetWindow.removeEventListener("focus", onFocus);
    targetWindow.document.removeEventListener("visibilitychange", updateFocusState);
  };
};

declare global {
  interface Window {
    __tileborneRuntimeAudio?: RuntimeAudioPlaybackEngine | undefined;
    __tilebornePlaytestAudio?: RuntimeAudioPlaybackEngine | undefined;
  }
}
