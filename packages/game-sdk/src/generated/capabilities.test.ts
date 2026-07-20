import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { builtInCapabilityIds, capabilityInventory } from './capabilities.js';

describe('generated capability discovery', () => {
  it('publishes one typed, agent-readable inventory and generated docs', async () => {
    expect(builtInCapabilityIds).toEqual([
      'lifecycle.core',
      'state.core',
      'time.deterministic',
      'shell.navigation',
    ]);
    expect(capabilityInventory.schemaVersion).toBe(1);
    const docs = await readFile(resolve(import.meta.dirname, '../../CAPABILITIES.md'), 'utf8');
    expect(docs).toContain('@tileborne/game-sdk/capabilities.json');
    expect(docs).toContain('`time.deterministic`');
    expect(
      capabilityInventory.capabilities.find(({ id }) => id === 'time.deterministic')?.events,
    ).toContain('runtime.tick');
    expect(
      capabilityInventory.capabilities.find(({ id }) => id === 'shell.navigation')?.actions,
    ).toEqual(['shell.invoke-action', 'shell.emit-event']);
  });
});
