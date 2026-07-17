import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_TOOL_VIEWS,
  WORKSPACE_VIEWS,
  workspaceViewForCommand,
  workspaceViewForKind,
} from './workspace-views';

describe('workspace-views registry', () => {
  it('has unique kinds and command ids', () => {
    const kinds = WORKSPACE_VIEWS.map((view) => view.kind);
    expect(new Set(kinds).size).toBe(kinds.length);

    const commandIds = WORKSPACE_VIEWS.flatMap((view) =>
      view.commandId === undefined ? [] : [view.commandId],
    );
    expect(new Set(commandIds).size).toBe(commandIds.length);
  });

  it('pathPattern round-trips the route for every view', () => {
    for (const view of WORKSPACE_VIEWS) {
      const pathname = view.route.replace('$projectId', 'project-123');
      const match = view.pathPattern.exec(pathname);
      expect(match?.[1], `pattern of ${view.kind} must match its own route`).toBe('project-123');
    }
  });

  it('patterns are anchored and do not cross-match other views', () => {
    for (const view of WORKSPACE_VIEWS) {
      const pathname = view.route.replace('$projectId', 'project-123');
      const matching = WORKSPACE_VIEWS.filter((other) => other.pathPattern.test(pathname));
      expect(matching.map((other) => other.kind)).toEqual([view.kind]);
    }
  });

  it('resolves views by kind and by command id', () => {
    expect(workspaceViewForKind('entity-editor').route).toBe('/projects/$projectId/entities');
    expect(workspaceViewForCommand('view.player-model-editor')?.kind).toBe('player-model-editor');
    expect(workspaceViewForCommand('view.unknown')).toBeUndefined();
  });

  it('exposes the tool editors in the Tools section', () => {
    expect(WORKSPACE_TOOL_VIEWS.map((view) => view.kind)).toEqual([
      'entity-editor',
      'game-content',
      'behaviors',
      'player-model-editor',
    ]);
  });
});
