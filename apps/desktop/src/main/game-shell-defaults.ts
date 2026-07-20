import type { ProjectId } from '@tileborne/core';
import type { GameModeDescriptor } from '@tileborne/plugin-api';
import {
  resolveInstalledGameShellDefaults as resolveInstalledGameShellDefaultsForPluginId,
  type InstalledGameShellDefaultsResult,
  type InstalledRuntimeDefaultsPlugin,
  type InvalidInstalledRuntimeDefaultsContribution,
} from '@tileborne/services-app';
import type { ReadinessDiagnostic } from '@tileborne/ipc-contracts';

import { readinessDiagnostic, readinessNavigation } from './readiness.js';

export type InvalidInstalledGameShellDefaults = Omit<
  InvalidInstalledRuntimeDefaultsContribution,
  'kind'
>;

export const resolveInstalledGameShellDefaults = (
  activeMode: GameModeDescriptor | undefined,
  installed: readonly InstalledRuntimeDefaultsPlugin[],
): InstalledGameShellDefaultsResult =>
  resolveInstalledGameShellDefaultsForPluginId(activeMode?.pluginId, installed);

export const gameShellDefaultsInvalidReadinessDiagnostic = (
  projectId: ProjectId,
  invalid: InvalidInstalledGameShellDefaults,
): ReadinessDiagnostic => {
  const path = `plugins.${invalid.pluginId}.runtime.shellDefaults.${invalid.contributionId}`;
  return readinessDiagnostic({
    id: `project:${projectId}:game-shell:plugin-defaults-invalid:${invalid.pluginId}:${invalid.contributionId}`,
    code: 'game-shell.plugin-defaults-invalid',
    severity: 'error',
    source: 'game-shell',
    title: 'Game shell plugin defaults are invalid',
    message: `Plugin ${invalid.pluginId} declares malformed Game Shell defaults (${invalid.contributionId}).`,
    projectId,
    path,
    navigation: readinessNavigation({
      kind: 'project-settings',
      projectId,
      path,
    }),
  });
};
