// @vitest-environment jsdom

import {
  makeMapId,
  makeProjectId,
  makeProjectManifest,
  makeTileborneMap,
  readPluginMapSettings,
  readPluginProjectSettings,
  type ProjectManifest,
  type TileborneMap,
} from '@tileborne/core';
import { materializeGameSettingsForm } from '@tileborne/plugin-api';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  updateMapMutate: vi.fn<(input: unknown) => Promise<void>>(),
  updateProjectMutate: vi.fn<(input: unknown) => Promise<void>>(),
  notifySuccess: vi.fn<(message: string) => void>(),
  notifyError: vi.fn<(message: string) => void>(),
  projectHolder: { current: undefined as ProjectManifest | undefined },
}));

vi.mock('@/hooks/mutations', () => ({
  useUpdateMap: () => ({ mutateAsync: hoisted.updateMapMutate, isPending: false }),
  useUpdateProject: () => ({ mutateAsync: hoisted.updateProjectMutate, isPending: false }),
}));

vi.mock('@/hooks/queries', () => ({
  useProject: () => ({
    data:
      hoisted.projectHolder.current === undefined
        ? undefined
        : { project: hoisted.projectHolder.current },
  }),
}));

vi.mock('@/stores/app-notifications-store', () => ({
  notifySuccess: hoisted.notifySuccess,
  notifyError: hoisted.notifyError,
}));

import { GenericModeSettingsPanel } from '@/components/plugins/generic-mode-settings-panel';

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix}`;
const PLUGIN_ID = '@example/mode';

const FIELDS = [{ key: 'maxPlayers', label: 'Max players', min: 1, step: 1, default: 32 }];

const materialize = (scope: 'map' | 'project') =>
  materializeGameSettingsForm({
    scope,
    invalidMessage: 'Settings must be positive numbers.',
    fields: FIELDS,
  });

const sampleMap = (): TileborneMap =>
  makeTileborneMap({
    id: makeMapId(uuid('446655440010')),
    width: 16,
    height: 16,
    tileWidth: 32,
    tileHeight: 32,
    properties: {},
  });

const sampleProject = (): ProjectManifest =>
  makeProjectManifest({ id: makeProjectId(uuid('446655440012')), name: 'Demo' });

describe('GenericModeSettingsPanel (scope-aware persistence)', () => {
  beforeEach(() => {
    hoisted.updateMapMutate.mockReset().mockResolvedValue(undefined);
    hoisted.updateProjectMutate.mockReset().mockResolvedValue(undefined);
    hoisted.notifySuccess.mockReset();
    hoisted.notifyError.mockReset();
    hoisted.projectHolder.current = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it('persists a scope:"map" form under map.properties.<pluginId> (BR path)', async () => {
    const map = sampleMap();
    render(
      <GenericModeSettingsPanel
        projectId="project-1"
        map={map}
        pluginId={PLUGIN_ID}
        label="Demo"
        form={materialize('map')}
      />,
    );

    fireEvent.change(screen.getByTestId('mode-setting-maxPlayers'), { target: { value: '16' } });
    fireEvent.click(screen.getByTestId('mode-setting-save'));

    await waitFor(() => expect(hoisted.updateMapMutate).toHaveBeenCalledTimes(1));
    expect(hoisted.updateProjectMutate).not.toHaveBeenCalled();

    const input = hoisted.updateMapMutate.mock.calls[0]?.[0] as {
      readonly projectId: string;
      readonly map: TileborneMap;
    };
    expect(input.projectId).toBe('project-1');
    expect(readPluginMapSettings(input.map, PLUGIN_ID)).toEqual({ maxPlayers: 16 });
  });

  it('persists a scope:"project" form under project.settings.<pluginId> (project owner)', async () => {
    hoisted.projectHolder.current = sampleProject();
    render(
      <GenericModeSettingsPanel
        projectId="project-1"
        map={sampleMap()}
        pluginId={PLUGIN_ID}
        label="Demo"
        form={materialize('project')}
      />,
    );

    fireEvent.change(screen.getByTestId('mode-setting-maxPlayers'), { target: { value: '24' } });
    fireEvent.click(screen.getByTestId('mode-setting-save'));

    await waitFor(() => expect(hoisted.updateProjectMutate).toHaveBeenCalledTimes(1));
    expect(hoisted.updateMapMutate).not.toHaveBeenCalled();

    const input = hoisted.updateProjectMutate.mock.calls[0]?.[0] as {
      readonly project: ProjectManifest;
    };
    expect(readPluginProjectSettings(input.project, PLUGIN_ID)).toEqual({ maxPlayers: 24 });
  });

  it('blocks a scope:"project" save until the project manifest has loaded', () => {
    // No project in the holder → query returns undefined → save is disabled so a
    // write is never attempted against a missing owner.
    hoisted.projectHolder.current = undefined;
    render(
      <GenericModeSettingsPanel
        projectId="project-1"
        map={sampleMap()}
        pluginId={PLUGIN_ID}
        label="Demo"
        form={materialize('project')}
      />,
    );

    expect((screen.getByTestId('mode-setting-save') as HTMLButtonElement).disabled).toBe(true);
  });
});
