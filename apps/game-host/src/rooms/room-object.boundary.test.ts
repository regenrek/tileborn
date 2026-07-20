import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const roomObjectPath = fileURLToPath(new URL('./room-object.ts', import.meta.url));
const roomTransportPath = fileURLToPath(new URL('./room-transport.ts', import.meta.url));

const FORBIDDEN_ROOM_PROTOCOL_PATTERNS: readonly RegExp[] = [
  /\bArenaPlayerInput\b/u,
  /\bArenaSnapshot\b/u,
  /\bArenaSnapshotAck\b/u,
  /\bBattleRoyaleProtocol\b/u,
  /\bDeltaSnapshot\b/u,
  /\bSnapshotAck\b/u,
  /\bPlayerInput\b/u,
  /\bWelcomeSnapshot\b/u,
  /\bWireError\b/u,
  /\bcreateBundledPluginProtocolBridge\b/u,
  /endsWith\('Snapshot'\)/u,
  /\.generated\/plugin-runtime/u,
  /@tileborne\/ipc-contracts\/protocols\/battle-royale/u,
];

describe('PlaytestRoom protocol boundary', () => {
  it('keeps battle-royale wire details out of the generic room host', async () => {
    const source = `${await readFile(roomObjectPath, 'utf8')}\n${await readFile(
      roomTransportPath,
      'utf8',
    )}`;
    const violations = FORBIDDEN_ROOM_PROTOCOL_PATTERNS.filter((pattern) => pattern.test(source));

    expect(violations.map(String), violations.map(String).join('\n')).toEqual([]);
  });
});
