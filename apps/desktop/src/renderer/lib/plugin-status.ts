export type PluginLifecycleStatus = 'enabled' | 'disabled' | 'update-available' | 'failed';

interface ResolvePluginLifecycleStatusInput {
  readonly enabled: boolean;
  readonly version: string;
  readonly manifestFailed: boolean;
}

export function resolvePluginLifecycleStatus(
  input: ResolvePluginLifecycleStatusInput,
): PluginLifecycleStatus {
  if (input.manifestFailed) {
    return 'failed';
  }
  if (input.version.includes('-stub')) {
    return 'update-available';
  }
  return input.enabled ? 'enabled' : 'disabled';
}

export function formatPluginLifecycleStatus(status: PluginLifecycleStatus): string {
  switch (status) {
    case 'enabled':
      return 'Enabled';
    case 'disabled':
      return 'Disabled';
    case 'update-available':
      return 'Update available';
    case 'failed':
      return 'Failed';
  }
}
