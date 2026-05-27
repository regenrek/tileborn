import { describe, expect, it } from 'vitest';

import { listPluginCapabilities } from './plugin-capabilities';

describe('listPluginCapabilities', () => {
  it('lists non-empty contribution slots with counts', () => {
    expect(
      listPluginCapabilities({
        editor: {
          commands: [{ id: 'a' }, { id: 'b' }],
          panels: [],
        },
        server: {
          serverSystems: [{ id: 'tick' }],
        },
      }),
    ).toEqual(['editor.commands (2)', 'server.serverSystems (1)']);
  });

  it('returns an empty list when contributes is empty', () => {
    expect(listPluginCapabilities({})).toEqual([]);
  });
});
