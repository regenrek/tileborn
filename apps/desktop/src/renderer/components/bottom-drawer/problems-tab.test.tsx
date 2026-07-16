// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.hoisted(() => vi.fn());
const useJobsMock = vi.hoisted(() => vi.fn());
const useReadinessMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ projectId: 'project:one', mapId: 'map:one' }),
}));

vi.mock('@/hooks/queries', () => ({
  useJobs: useJobsMock,
  useReadiness: useReadinessMock,
}));

import { ProblemsTab } from './problems-tab';
import { consumeBehaviorSourceNavigation } from '@/lib/behavior-source-navigation';
import { useEditorUiStore } from '@/stores/editor-ui-store';

describe('ProblemsTab readiness surface', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    useJobsMock.mockReturnValue({ data: { jobs: [] }, isLoading: false });
    useReadinessMock.mockReturnValue({
      data: {
        report: {
          ok: false,
          purpose: 'authoring',
          diagnostics: [
            {
              id: 'missing-spawns',
              code: 'game-mode.map-validation',
              severity: 'error',
              source: 'map',
              title: 'Battle Royale map error',
              message: 'Expected at least four spawn points.',
              projectId: 'project:one',
              mapId: 'map:one',
              navigation: {
                kind: 'map',
                projectId: 'project:one',
                mapId: 'map:one',
                path: 'objects',
              },
            },
            {
              id: 'active-mode',
              code: 'game-mode.active',
              severity: 'info',
              source: 'game-mode',
              title: 'Battle Royale active',
              message: 'Battle Royale owns validation.',
              projectId: 'project:one',
            },
          ],
        },
      },
      isLoading: false,
    });
  });

  afterEach(cleanup);

  it('renders canonical readiness severities and navigates a map diagnostic', () => {
    render(<ProblemsTab />);

    const problems = screen.getAllByTestId('readiness-problem');
    expect(problems).toHaveLength(2);
    expect(problems[0]?.getAttribute('data-severity')).toBe('error');
    expect(problems[0]?.getAttribute('data-source')).toBe('map');
    expect(screen.getByText('Expected at least four spawn points.')).toBeTruthy();

    fireEvent.click(problems[0]!);
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/projects/$projectId/maps/$mapId',
      params: { projectId: 'project:one', mapId: 'map:one' },
    });
  });

  it('keeps failed jobs in the same problems surface', () => {
    useJobsMock.mockReturnValue({
      data: { jobs: [{ id: 'job:deadbeef', status: 'Failed', errorMessage: 'Build failed.' }] },
      isLoading: false,
    });
    render(<ProblemsTab />);

    expect(screen.getByText('Build failed.')).toBeTruthy();
    expect(screen.getByText('Failed jobs')).toBeTruthy();
  });

  it('deep-links catalog entities and map objects into the owning editor selection', () => {
    useReadinessMock.mockReturnValue({
      data: {
        report: {
          ok: false,
          purpose: 'authoring',
          diagnostics: [
            {
              id: 'catalog-object',
              code: 'catalog.invalid',
              severity: 'error',
              source: 'catalog',
              title: 'Catalog object',
              message: 'Fix entity',
              projectId: 'project:one',
              navigation: {
                kind: 'catalog',
                projectId: 'project:one',
                objectTypeId: 'object-type:rifle',
              },
            },
            {
              id: 'map-object',
              code: 'map.object',
              severity: 'error',
              source: 'map',
              title: 'Map object',
              message: 'Fix object',
              projectId: 'project:one',
              mapId: 'map:one',
              navigation: {
                kind: 'map-object',
                projectId: 'project:one',
                mapId: 'map:one',
                objectId: 'object:spawn',
              },
            },
          ],
        },
      },
      isLoading: false,
    });
    render(<ProblemsTab />);
    const problems = screen.getAllByTestId('readiness-problem');

    fireEvent.click(problems[0]!);
    expect(useEditorUiStore.getState().catalogTargetObjectTypeId).toBe('object-type:rifle');
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/projects/$projectId/entities',
      params: { projectId: 'project:one' },
    });

    fireEvent.click(problems[1]!);
    expect([...useEditorUiStore.getState().selection]).toEqual(['object:spawn']);
    expect(useEditorUiStore.getState().activeTool).toBe('select');
  });

  it('deep-links behavior diagnostics to the exact visual block or TypeScript source position', () => {
    useReadinessMock.mockReturnValue({
      data: {
        report: {
          ok: false,
          purpose: 'authoring',
          diagnostics: [
            {
              id: 'behavior-source',
              code: 'behavior.compile',
              severity: 'error',
              source: 'behavior',
              title: 'Behavior source',
              message: 'Fix the owning behavior',
              projectId: 'project:one',
              behaviorId: 'behavior:00000000-0000-4000-8000-000000000001',
              behaviorNodeId: 'behavior-node:00000000-0000-4000-8000-000000000002',
              sourceKind: 'visual',
              path: 'behaviors/proof.behavior.json',
              line: 4,
              column: 7,
              navigation: {
                kind: 'behavior',
                projectId: 'project:one',
                behaviorId: 'behavior:00000000-0000-4000-8000-000000000001',
                behaviorNodeId: 'behavior-node:00000000-0000-4000-8000-000000000002',
                sourceKind: 'visual',
                path: 'behaviors/proof.behavior.json',
                line: 4,
                column: 7,
              },
            },
          ],
        },
      },
      isLoading: false,
    });
    render(<ProblemsTab />);

    fireEvent.click(screen.getByTestId('readiness-problem'));
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/projects/$projectId/behaviors',
      params: { projectId: 'project:one' },
    });
    expect(consumeBehaviorSourceNavigation('project:one')).toEqual({
      projectId: 'project:one',
      behaviorId: 'behavior:00000000-0000-4000-8000-000000000001',
      nodeId: 'behavior-node:00000000-0000-4000-8000-000000000002',
      sourcePath: 'behaviors/proof.behavior.json',
      line: 4,
      column: 7,
    });
  });
});
