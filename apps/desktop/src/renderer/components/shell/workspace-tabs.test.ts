import { describe, expect, it } from 'vitest';

import { describeTabForPath } from './workspace-tabs';

describe('describeTabForPath', () => {
  it('decodes encoded project ids before creating tab descriptors', () => {
    expect(
      describeTabForPath('/projects/project%253Af317f4c8-1c50-4186-b22d-a530f1c3ff90'),
    ).toEqual({
      kind: 'overview',
      projectId: 'project:f317f4c8-1c50-4186-b22d-a530f1c3ff90',
    });
  });

  it('decodes encoded map route params before creating tab descriptors', () => {
    expect(
      describeTabForPath(
        '/projects/project%3Af317f4c8-1c50-4186-b22d-a530f1c3ff90/maps/map%3A3cdc898a-e697-4e8d-a2d4-fa5d203fa7f3',
      ),
    ).toEqual({
      kind: 'map',
      projectId: 'project:f317f4c8-1c50-4186-b22d-a530f1c3ff90',
      mapId: 'map:3cdc898a-e697-4e8d-a2d4-fa5d203fa7f3',
    });
  });

  it('creates workspace descriptors for visual editor workbench routes', () => {
    expect(describeTabForPath('/projects/project%3Aone/entities')).toEqual({
      kind: 'entity-editor',
      projectId: 'project:one',
    });
    expect(describeTabForPath('/projects/project%3Aone/player-models')).toEqual({
      kind: 'player-model-editor',
      projectId: 'project:one',
    });
  });
});
