import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const roomObjectPath = fileURLToPath(new URL('./room-object.ts', import.meta.url));

const FORBIDDEN_ROOM_PROTOCOL_PATTERNS: readonly RegExp[] = [
  /\bBattleRoyaleProtocol\b/u,
  /\bPlayerInput\b/u,
  /\bWelcomeSnapshot\b/u,
  /\bWireError\b/u,
  /@tileborne\/ipc-contracts\/protocols\/battle-royale/u,
];

describe('PlaytestRoom protocol boundary', () => {
  it('keeps battle-royale wire details out of the room object', async () => {
    const source = await readFile(roomObjectPath, 'utf8');
    const violations = FORBIDDEN_ROOM_PROTOCOL_PATTERNS.filter((pattern) => pattern.test(source));

    expect(violations.map(String), violations.map(String).join('\n')).toEqual([]);
  });
});
