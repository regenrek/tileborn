import type { ProjectId } from '@tileborne/core';
import {
  decodeGameShellDefaultsDefinition,
  type GameShellDefaultsDefinition,
  type RuntimeAudioBusDefinition,
  type RuntimeAudioCueDefinition,
} from '@tileborne/runtime';
import { Effect, Option } from 'effect';

import { ProjectAudioService } from './audio/index.js';
import { ProjectGameShellService } from './shell/index.js';

export interface InstalledRuntimeDefaultsPlugin {
  readonly id: string;
  readonly enabled: boolean;
  readonly manifest: {
    readonly contributes: {
      readonly runtime?: Option.Option<{
        readonly shellDefaults?: Option.Option<
          readonly {
            readonly id: string;
            readonly data: unknown;
          }[]
        >;
        readonly audioBuses?: Option.Option<
          readonly {
            readonly id: string;
            readonly data: unknown;
          }[]
        >;
      }>;
    };
  };
}

export interface InvalidInstalledRuntimeDefaultsContribution {
  readonly pluginId: string;
  readonly contributionId: string;
  readonly kind: 'shell-defaults' | 'audio-bus';
}

export interface InstalledRuntimeAudioDefaults {
  readonly contributionId: string;
  readonly buses: readonly RuntimeAudioBusDefinition[];
  readonly cues: readonly (RuntimeAudioCueDefinition & {
    readonly binding?: string;
  })[];
}

export interface InstalledPluginRuntimeDefaultsResult {
  readonly pluginId?: string | undefined;
  readonly shellDefaults?: GameShellDefaultsDefinition | undefined;
  readonly audioDefaults?: InstalledRuntimeAudioDefaults | undefined;
  readonly invalid?: InvalidInstalledRuntimeDefaultsContribution | undefined;
}

export interface InstalledGameShellDefaultsResult {
  readonly defaults?: GameShellDefaultsDefinition | undefined;
  readonly invalid?:
    | {
        readonly pluginId: string;
        readonly contributionId: string;
      }
    | undefined;
}

const runtimeContributionValue = <T>(value: Option.Option<T> | undefined): T | undefined =>
  value === undefined ? undefined : Option.getOrUndefined(value);

const isRuntimeAudioDefaults = (
  value: unknown,
): value is Omit<InstalledRuntimeAudioDefaults, 'contributionId'> => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    readonly buses?: unknown;
    readonly cues?: unknown;
  };
  return Array.isArray(candidate.buses) && Array.isArray(candidate.cues);
};

export const resolveInstalledPluginRuntimeDefaults = (
  activePluginId: string | undefined,
  installed: readonly InstalledRuntimeDefaultsPlugin[],
): InstalledPluginRuntimeDefaultsResult => {
  const plugin = installed.find((entry) => entry.enabled && entry.id === activePluginId);
  if (plugin === undefined) return {};
  const runtime = runtimeContributionValue(plugin.manifest.contributes.runtime);
  if (runtime === undefined) return { pluginId: plugin.id };

  const shellContribution = runtimeContributionValue(runtime.shellDefaults)?.[0];
  const shellDefaults =
    shellContribution === undefined
      ? undefined
      : decodeGameShellDefaultsDefinition(plugin.id, shellContribution.data);
  if (shellContribution !== undefined && shellDefaults === undefined) {
    return {
      pluginId: plugin.id,
      invalid: {
        pluginId: plugin.id,
        contributionId: shellContribution.id,
        kind: 'shell-defaults',
      },
    };
  }

  const audioContribution = runtimeContributionValue(runtime.audioBuses)?.[0];
  const audioDefaultsData = audioContribution?.data;
  const audioDefaults =
    audioDefaultsData === undefined
      ? undefined
      : isRuntimeAudioDefaults(audioDefaultsData)
        ? audioDefaultsData
        : undefined;
  if (audioContribution !== undefined && audioDefaults === undefined) {
    return {
      pluginId: plugin.id,
      shellDefaults,
      invalid: {
        pluginId: plugin.id,
        contributionId: audioContribution.id,
        kind: 'audio-bus',
      },
    };
  }

  return {
    pluginId: plugin.id,
    shellDefaults,
    ...(audioContribution === undefined
      ? {}
      : {
          audioDefaults: {
            contributionId: audioContribution.id,
            buses: audioDefaults!.buses,
            cues: audioDefaults!.cues,
          },
        }),
  };
};

export const resolveInstalledGameShellDefaults = (
  activePluginId: string | undefined,
  installed: readonly InstalledRuntimeDefaultsPlugin[],
): InstalledGameShellDefaultsResult => {
  const defaults = resolveInstalledPluginRuntimeDefaults(activePluginId, installed);
  return {
    defaults: defaults.shellDefaults,
    invalid:
      defaults.invalid?.kind === 'shell-defaults'
        ? {
            pluginId: defaults.invalid.pluginId,
            contributionId: defaults.invalid.contributionId,
          }
        : undefined,
  };
};

export const applyInstalledPluginRuntimeDefaults = (
  projectId: ProjectId,
  activePluginId: string,
  installed: readonly InstalledRuntimeDefaultsPlugin[],
  options: {
    readonly shell?:
      | {
          readonly mainMenuTitle?: string | undefined;
          readonly mainMenuSubtitle?: string | undefined;
        }
      | undefined;
  } = {},
) =>
  Effect.gen(function* () {
    const defaults = resolveInstalledPluginRuntimeDefaults(activePluginId, installed);
    if (defaults.invalid !== undefined) {
      throw new Error(
        `Plugin ${defaults.invalid.pluginId} declares malformed ${defaults.invalid.kind} defaults (${defaults.invalid.contributionId})`,
      );
    }
    if (defaults.pluginId === undefined) {
      throw new Error(`Installed plugin ${activePluginId} was not enabled or could not be found`);
    }

    if (defaults.shellDefaults !== undefined) {
      const shell = yield* ProjectGameShellService;
      yield* shell.apply(
        projectId,
        { type: 'apply-plugin-defaults', pluginId: activePluginId },
        { defaults: defaults.shellDefaults },
      );
      if (
        options.shell?.mainMenuTitle !== undefined ||
        options.shell?.mainMenuSubtitle !== undefined
      ) {
        yield* shell.apply(projectId, {
          type: 'set-screen-text',
          screenId: 'main-menu',
          title: options.shell.mainMenuTitle ?? 'Main Menu',
          subtitle: options.shell.mainMenuSubtitle ?? '',
        });
      }
    }

    if (defaults.audioDefaults !== undefined) {
      const audio = yield* ProjectAudioService;
      for (const cue of defaults.audioDefaults.cues) {
        if (cue.source === undefined) {
          throw new Error(`Plugin ${activePluginId} audio cue ${cue.id} did not declare a source`);
        }
        const bus = defaults.audioDefaults.buses.find((entry) => entry.id === cue.busId);
        yield* audio.apply(projectId, {
          type: 'import',
          label: cue.label,
          classification: bus?.kind ?? 'sfx',
          source: cue.source,
        });
        if (cue.binding !== undefined) {
          yield* audio.apply(projectId, {
            type: 'bind',
            binding: cue.binding,
            label: cue.label,
          });
        }
      }
    }

    return defaults;
  });
