import { dispatchRuntimeAudioEvent, type RuntimeAudioCueDefinition } from '@tileborne/runtime';
import type { GameplayEvent } from '@tileborne/ipc-contracts';

import { eventKey } from '../hud/hud-state.js';
import type { RuntimeAudioPlaybackEngine } from './browser-audio-engine.js';

export const runtimeAudioEventsForGameplayEvent = (
  event: GameplayEvent,
): readonly Parameters<typeof dispatchRuntimeAudioEvent>[2][] => {
  switch (event._tag) {
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
  readonly events: readonly GameplayEvent[];
  readonly seenKeys: Set<string>;
}): readonly string[] => {
  if (engine === undefined || cues.length === 0 || events.length === 0) {
    return [];
  }
  const dispatched: string[] = [];
  for (const event of events) {
    const key = eventKey(event);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    for (const audioEvent of runtimeAudioEventsForGameplayEvent(event)) {
      const cueId = dispatchRuntimeAudioEvent(engine, cues, audioEvent);
      if (cueId !== undefined) {
        dispatched.push(cueId);
      }
    }
  }
  return dispatched;
};
