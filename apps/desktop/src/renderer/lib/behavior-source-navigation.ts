export interface BehaviorSourceNavigationTarget {
  readonly projectId: string;
  readonly behaviorId: string;
  readonly nodeId?: string;
  readonly sourcePath?: string;
  readonly line?: number;
  readonly column?: number;
}

const STORAGE_KEY = 'tileborne:behavior-source-navigation';

export const requestBehaviorSourceNavigation = (
  target: BehaviorSourceNavigationTarget,
): void => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
};

export const consumeBehaviorSourceNavigation = (
  projectId: string,
): BehaviorSourceNavigationTarget | undefined => {
  const encoded = sessionStorage.getItem(STORAGE_KEY);
  if (encoded === null) return undefined;
  sessionStorage.removeItem(STORAGE_KEY);
  try {
    const value = JSON.parse(encoded) as Partial<BehaviorSourceNavigationTarget>;
    if (
      value.projectId !== projectId ||
      typeof value.behaviorId !== 'string' ||
      (value.nodeId !== undefined && typeof value.nodeId !== 'string') ||
      (value.sourcePath !== undefined && typeof value.sourcePath !== 'string') ||
      (value.line !== undefined && (!Number.isInteger(value.line) || value.line < 1)) ||
      (value.column !== undefined && (!Number.isInteger(value.column) || value.column < 1))
    ) {
      return undefined;
    }
    return {
      projectId,
      behaviorId: value.behaviorId,
      ...(value.nodeId === undefined ? {} : { nodeId: value.nodeId }),
      ...(value.sourcePath === undefined ? {} : { sourcePath: value.sourcePath }),
      ...(value.line === undefined ? {} : { line: value.line }),
      ...(value.column === undefined ? {} : { column: value.column }),
    };
  } catch {
    return undefined;
  }
};

export const sourcePositionOffset = (
  source: string,
  line = 1,
  column = 1,
): number => {
  const lines = source.split('\n');
  const lineIndex = Math.max(0, Math.min(lines.length - 1, line - 1));
  const prefix = lines.slice(0, lineIndex).reduce((length, value) => length + value.length + 1, 0);
  return prefix + Math.max(0, Math.min(lines[lineIndex]?.length ?? 0, column - 1));
};
