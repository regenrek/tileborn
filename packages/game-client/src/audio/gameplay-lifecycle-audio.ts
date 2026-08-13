import { dispatchRuntimeAudioEvent, type RuntimeAudioCueDefinition } from '@tileborne/runtime';
import type { GameplayEvent, SequencedGameplayEvent } from '@tileborne/ipc-contracts';

import { eventKey } from '../hud/hud-state.js';
import type { RuntimeAudioPlaybackEngine } from './browser-audio-engine.js';

export const GAMEPLAY_AUDIO_EVENT_KEY_WINDOW = 20;

type AudioDedupeEntry = {
  readonly sequence: number;
};

type AudioDedupeState = {
  readonly entries: Map<string, AudioDedupeEntry>;
  completedThroughSequence: number;
  nextSequence: number;
};

const audioDedupeStates = new WeakMap<Set<string>, AudioDedupeState>();

const audioDedupeStateFor = (seenKeys: Set<string>): AudioDedupeState => {
  let state = audioDedupeStates.get(seenKeys);
  if (state === undefined) {
    state = {
      entries: new Map(),
      completedThroughSequence: -1,
      nextSequence: 0,
    };
    audioDedupeStates.set(seenKeys, state);
  } else if (
    seenKeys.size === 0 &&
    (state.entries.size > 0 || state.completedThroughSequence >= 0)
  ) {
    state.entries.clear();
    state.completedThroughSequence = -1;
    state.nextSequence = 0;
  }
  return state;
};

const pruneAudioDedupeState = (state: AudioDedupeState, seenKeys: Set<string>): void => {
  while (state.entries.size > GAMEPLAY_AUDIO_EVENT_KEY_WINDOW) {
    let oldestKey: string | undefined;
    let oldestEntry: AudioDedupeEntry | undefined;
    for (const [key, entry] of state.entries) {
      if (oldestEntry === undefined || entry.sequence < oldestEntry.sequence) {
        oldestKey = key;
        oldestEntry = entry;
      }
    }
    if (oldestKey === undefined || oldestEntry === undefined) {
      return;
    }
    state.entries.delete(oldestKey);
    seenKeys.delete(oldestKey);
  }
};

export const runtimeAudioEventsForGameplayEvent = (
  event: GameplayEvent,
): readonly Parameters<typeof dispatchRuntimeAudioEvent>[2][] => {
  switch (event._tag) {
    case 'WeaponFired':
      return ['weapon.fire'];
    case 'DamageApplied':
      return ['player.hit'];
    case 'EntityDefeated':
      return ['player.eliminated'];
    case 'ItemGranted':
      return ['item.collect'];
    case 'ZonePhaseChanged':
      return event.phase === 'stable' ? [] : ['environment.zoneWarning'];
    case 'MatchPhaseChanged':
      return event.phase === 'finished' || event.phase === 'game-over' ? ['match.end'] : [];
    default:
      return [];
  }
};

export const dispatchGameplayLifecycleAudioEvents = ({
  engine,
  cues,
  events,
  seenKeys,
}: {
  readonly engine: RuntimeAudioPlaybackEngine | undefined;
  readonly cues: readonly RuntimeAudioCueDefinition[];
  readonly events: readonly SequencedGameplayEvent[];
  readonly seenKeys: Set<string>;
}): readonly string[] => {
  if (engine === undefined || cues.length === 0 || events.length === 0) {
    return [];
  }
  const state = audioDedupeStateFor(seenKeys);

  for (const key of seenKeys) {
    if (!state.entries.has(key)) {
      state.entries.set(key, { sequence: state.nextSequence++ });
    }
  }

  const dispatched: string[] = [];
  let completedThroughSequence = state.completedThroughSequence;
  for (const sequencedEvent of events) {
    const { event, sequence } = sequencedEvent;
    const key = eventKey(event);
    if (state.entries.has(key)) {
      continue;
    }
    if (sequence >= 0 && sequence <= state.completedThroughSequence) {
      continue;
    }
    if (sequence >= 0 && sequence > completedThroughSequence) {
      completedThroughSequence = sequence;
    }
    seenKeys.add(key);
    state.entries.set(key, { sequence: state.nextSequence++ });
    for (const audioEvent of runtimeAudioEventsForGameplayEvent(event)) {
      const cueId = dispatchRuntimeAudioEvent(engine, cues, audioEvent);
      if (cueId !== undefined) {
        dispatched.push(cueId);
      }
    }
  }
  state.completedThroughSequence = completedThroughSequence;
  pruneAudioDedupeState(state, seenKeys);
  return dispatched;
};
