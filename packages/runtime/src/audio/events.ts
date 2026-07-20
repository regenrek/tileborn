import type { RuntimeAudioCueDefinition } from './mixer.js';

export type RuntimeAudioEvent =
  | 'shell.titleMusic'
  | 'shell.menuMusic'
  | 'shell.loadingMusic'
  | 'shell.pauseMusic'
  | 'shell.resultsMusic'
  | 'weapon.fire'
  | 'weapon.reload'
  | 'item.collect'
  | 'player.hit'
  | 'player.eliminated'
  | 'environment.zoneWarning'
  | 'environment.ambientLoop'
  | 'match.start'
  | 'match.end';

export interface RuntimeAudioCueDispatcher {
  readonly playCue: (cueId: string) => unknown;
}

export const runtimeAudioCueForEvent = (
  cues: readonly RuntimeAudioCueDefinition[],
  event: RuntimeAudioEvent,
): string | undefined => cues.find((cue) => cue.binding === event)?.id;

export const dispatchRuntimeAudioEvent = (
  dispatcher: RuntimeAudioCueDispatcher | undefined,
  cues: readonly RuntimeAudioCueDefinition[],
  event: RuntimeAudioEvent,
): string | undefined => {
  const cueId = runtimeAudioCueForEvent(cues, event);
  if (cueId !== undefined) dispatcher?.playCue(cueId);
  return cueId;
};
