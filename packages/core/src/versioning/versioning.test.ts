import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineMigrationChain, readSchemaVersion } from './index.js';

describe('versioning', () => {
  it('reads schemaVersion from persisted JSON', () => {
    expect(readSchemaVersion({ schemaVersion: 1 })).toBe(1);
    expect(readSchemaVersion({ schemaVersion: 1.5 })).toBeUndefined();
    expect(readSchemaVersion({})).toBeUndefined();
  });

  it('applies sequential migrators', () => {
    const chain = defineMigrationChain<number>({
      entity: 'demo',
      latestVersion: 2,
      migrators: [
        {
          entity: 'demo',
          fromVersion: 1,
          toVersion: 2,
          migrate: (input) => (input as number) + 1,
        },
      ],
    });

    const migrated = chain.migrateToLatest(1, 1);
    expect(Result.isSuccess(migrated)).toBe(true);
    if (Result.isSuccess(migrated)) {
      expect(migrated.success).toBe(2);
    }

    const alreadyLatest = chain.migrateToLatest(2, 2);
    expect(Result.isSuccess(alreadyLatest)).toBe(true);
    if (Result.isSuccess(alreadyLatest)) {
      expect(alreadyLatest.success).toBe(2);
    }

    const downgrade = chain.migrateToLatest(1, 3);
    expect(Result.isFailure(downgrade)).toBe(true);
    if (Result.isFailure(downgrade)) {
      expect(downgrade.failure).toBe('demo: cannot downgrade from v3 to v2');
    }
  });
});
