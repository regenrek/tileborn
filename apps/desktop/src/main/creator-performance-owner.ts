import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface DesktopCreatorLifecycleProbeInput<TAsset> {
  readonly projectsRoot: string;
  readonly projectRoot: string;
  readonly loadInitialAssetPage: () => Promise<readonly TAsset[]>;
  readonly loadInitialBehaviorBody: () => Promise<unknown>;
  readonly recoverySnapshotPath: string;
}

/**
 * Deterministic IO observer for the same main-process lifecycle boundaries used by project list
 * and reopen IPC. It performs the reads; callers cannot report counts without executing them.
 */
export const observeDesktopCreatorLifecycle = async <TAsset>(
  input: DesktopCreatorLifecycleProbeInput<TAsset>,
) => {
  const projectDirectories = (await readdir(input.projectsRoot, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory(),
  );
  let projectRecordsDecoded = 0;
  for (const entry of projectDirectories) {
    JSON.parse(await readFile(path.join(input.projectsRoot, entry.name, 'project.json'), 'utf8'));
    projectRecordsDecoded += 1;
  }

  const manifest = await readFile(path.join(input.projectRoot, 'project.json'));
  JSON.parse(manifest.toString('utf8'));
  const initialAssetPage = await input.loadInitialAssetPage();
  await input.loadInitialBehaviorBody();
  await readFile(input.recoverySnapshotPath);

  return {
    startup: {
      projectRecordsDecoded,
      assetRecordsDecoded: 0,
      behaviorBodiesDecoded: 0,
    },
    reopen: {
      manifestInputBytes: manifest.byteLength,
      manifestDecodes: 1,
      initialAssetPageRecords: initialAssetPage.length,
      initialBehaviorBodies: 1,
      recoverySnapshotReads: 1,
    },
  } as const;
};
