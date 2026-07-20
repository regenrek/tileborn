import { describe, expect, it, vi } from 'vitest';

import { dispatchRuntimeAudioEvent, runtimeAudioCueForEvent } from './events.js';
import type { RuntimeAudioCueDefinition } from './mixer.js';

const cues: readonly RuntimeAudioCueDefinition[] = [
  {
    id: 'cue:menu',
    label: 'Menu',
    busId: 'project.music',
    defaultVolume: 1,
    binding: 'shell.menuMusic',
  },
  {
    id: 'cue:hit',
    label: 'Hit',
    busId: 'project.sfx',
    defaultVolume: 1,
    binding: 'player.hit',
  },
  {
    id: 'cue:end',
    label: 'End',
    busId: 'project.sfx',
    defaultVolume: 1,
    binding: 'match.end',
  },
];

describe('runtime audio event dispatch', () => {
  it('resolves neutral lifecycle and gameplay events through cue bindings', () => {
    expect(runtimeAudioCueForEvent(cues, 'shell.menuMusic')).toBe('cue:menu');
    expect(runtimeAudioCueForEvent(cues, 'player.hit')).toBe('cue:hit');
    expect(runtimeAudioCueForEvent(cues, 'match.end')).toBe('cue:end');
    expect(runtimeAudioCueForEvent(cues, 'environment.zoneWarning')).toBeUndefined();
  });

  it('dispatches resolved cue ids to the supplied playback adapter', () => {
    const dispatcher = { playCue: vi.fn() };

    expect(dispatchRuntimeAudioEvent(dispatcher, cues, 'player.hit')).toBe('cue:hit');
    expect(dispatchRuntimeAudioEvent(dispatcher, cues, 'environment.zoneWarning')).toBeUndefined();

    expect(dispatcher.playCue).toHaveBeenCalledTimes(1);
    expect(dispatcher.playCue).toHaveBeenCalledWith('cue:hit');
  });
});
