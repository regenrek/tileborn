import { Result } from 'effect';

/** Single-step schema migrator between two integer versions. */
export interface SchemaMigrator<From, To> {
  readonly entity: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (input: From) => To;
}

/** Ordered chain of migrators for one entity type. */
export interface SchemaMigrationChain<T> {
  readonly entity: string;
  readonly latestVersion: number;
  readonly migrators: readonly SchemaMigrator<unknown, unknown>[];
  readonly migrateToLatest: (input: unknown, fromVersion: number) => Result.Result<T, string>;
}

/** Build a migration chain that applies migrators sequentially up to `latestVersion`. */
export const defineMigrationChain = <T>(args: {
  readonly entity: string;
  readonly latestVersion: number;
  readonly migrators: readonly SchemaMigrator<unknown, unknown>[];
}): SchemaMigrationChain<T> => {
  const byFrom = new Map(args.migrators.map((m) => [m.fromVersion, m] as const));

  const migrateToLatest = (input: unknown, fromVersion: number): Result.Result<T, string> => {
    if (fromVersion === args.latestVersion) {
      return Result.succeed(input as T);
    }

    if (fromVersion > args.latestVersion) {
      return Result.fail(
        `${args.entity}: cannot downgrade from v${fromVersion} to v${args.latestVersion}`,
      );
    }

    let current = input;
    let version = fromVersion;

    while (version < args.latestVersion) {
      const migrator = byFrom.get(version);
      if (!migrator) {
        return Result.fail(`${args.entity}: missing migrator from v${version}`);
      }
      current = migrator.migrate(current);
      version = migrator.toVersion;
    }

    return Result.succeed(current as T);
  };

  return {
    entity: args.entity,
    latestVersion: args.latestVersion,
    migrators: args.migrators,
    migrateToLatest,
  };
};

/** Read `schemaVersion` from unknown persisted JSON. */
export const readSchemaVersion = (input: unknown): number | undefined => {
  if (typeof input !== 'object' || input === null || !('schemaVersion' in input)) {
    return undefined;
  }
  const version = (input as { schemaVersion: unknown }).schemaVersion;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
};

/** Current schema versions for core persisted entities. */
export const CORE_SCHEMA_VERSIONS = {
  project: 1,
  map: 1,
  assetPackManifest: 1,
  brandConfig: 1,
} as const;

export type CoreSchemaEntity = keyof typeof CORE_SCHEMA_VERSIONS;
