const countArrayContribution = (prefix: string, value: unknown, capabilities: string[]): void => {
  if (Array.isArray(value) && value.length > 0) {
    capabilities.push(`${prefix} (${value.length})`);
  }
};

const walkContributionGroup = (
  groupPrefix: string,
  group: Record<string, unknown>,
  capabilities: string[],
): void => {
  for (const [key, value] of Object.entries(group)) {
    countArrayContribution(`${groupPrefix}.${key}`, value, capabilities);
  }
};

export function listPluginCapabilities(contributes: Record<string, unknown>): readonly string[] {
  const capabilities: string[] = [];

  countArrayContribution('assetPacks', contributes.assetPacks, capabilities);
  countArrayContribution('tilesetPacks', contributes.tilesetPacks, capabilities);
  countArrayContribution('objectKinds', contributes.objectKinds, capabilities);

  if (contributes.editor !== undefined && typeof contributes.editor === 'object') {
    walkContributionGroup('editor', contributes.editor as Record<string, unknown>, capabilities);
  }

  if (contributes.runtime !== undefined && typeof contributes.runtime === 'object') {
    walkContributionGroup('runtime', contributes.runtime as Record<string, unknown>, capabilities);
  }

  if (contributes.server !== undefined && typeof contributes.server === 'object') {
    walkContributionGroup('server', contributes.server as Record<string, unknown>, capabilities);
  }

  return capabilities.sort((left, right) => left.localeCompare(right));
}
