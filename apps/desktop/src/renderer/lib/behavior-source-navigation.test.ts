import { beforeEach, describe, expect, it } from 'vitest';

import {
  consumeBehaviorSourceNavigation,
  requestBehaviorSourceNavigation,
  sourcePositionOffset,
} from './behavior-source-navigation';

describe('behavior source navigation', () => {
  beforeEach(() => sessionStorage.clear());

  it('delivers an exact behavior/node target once and never crosses projects', () => {
    requestBehaviorSourceNavigation({
      projectId: 'project:a',
      behaviorId: 'behavior:a',
      nodeId: 'behavior-node:a',
      sourcePath: 'behaviors/source.ts',
      line: 3,
      column: 5,
    });
    expect(consumeBehaviorSourceNavigation('project:b')).toBeUndefined();

    requestBehaviorSourceNavigation({
      projectId: 'project:a',
      behaviorId: 'behavior:a',
      nodeId: 'behavior-node:a',
      sourcePath: 'behaviors/source.ts',
      line: 3,
      column: 5,
    });
    expect(consumeBehaviorSourceNavigation('project:a')).toEqual({
      projectId: 'project:a',
      behaviorId: 'behavior:a',
      nodeId: 'behavior-node:a',
      sourcePath: 'behaviors/source.ts',
      line: 3,
      column: 5,
    });
    expect(consumeBehaviorSourceNavigation('project:a')).toBeUndefined();
  });

  it('maps one-based TypeScript diagnostic positions to a bounded caret offset', () => {
    const source = 'first\nsecond line\nthird';
    expect(sourcePositionOffset(source, 2, 4)).toBe(9);
    expect(sourcePositionOffset(source, 99, 99)).toBe(source.length);
    expect(sourcePositionOffset(source, 0, 0)).toBe(0);
  });
});
