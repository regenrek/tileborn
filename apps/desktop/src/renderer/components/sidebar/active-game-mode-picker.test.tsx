// @vitest-environment jsdom

import { makeProjectId, makeProjectManifest, type ProjectManifest } from '@tileborne/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const battleRoyalePluginId = ['@tileborne-plugins', 'battle-royale'].join('/');
const arenaPluginId = ['@tileborne-plugins', 'example-arena'].join('/');

const hoisted = vi.hoisted(() => ({
  updateProjectMutate: vi.fn<(input: unknown) => Promise<void>>(),
  notifySuccess: vi.fn<(message: string) => void>(),
  notifyError: vi.fn<(message: string) => void>(),
  projectHolder: { current: undefined as ProjectManifest | undefined },
}));

vi.mock('@tileborne/ui', () => ({
  cn: (...classes: readonly unknown[]) => classes.filter(Boolean).join(' '),
  typography: {
    panelTitle: '',
    bodyMicro: '',
  },
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    readonly value: string;
    readonly onValueChange: (value: string) => void;
    readonly disabled?: boolean | undefined;
    readonly children: ReactNode;
  }) => (
    <select
      data-testid="active-game-mode-native-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { readonly value: string; readonly children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock('@/hooks/mutations', () => ({
  useUpdateProject: () => ({ mutateAsync: hoisted.updateProjectMutate, isPending: false }),
}));

vi.mock('@/hooks/queries', () => ({
  useProject: () => ({
    data:
      hoisted.projectHolder.current === undefined
        ? undefined
        : { project: hoisted.projectHolder.current },
  }),
  usePluginContributions: () => ({
    data: {
      panels: [],
      tools: [],
      gameModes: [
        {
          modeId: battleRoyalePluginId,
          pluginId: battleRoyalePluginId,
          label: 'Battle Royale',
          runtimeSystemId: 'battle-royale-runtime',
          hasAuthoringPanel: true,
        },
        {
          modeId: arenaPluginId,
          pluginId: arenaPluginId,
          label: 'Example Arena',
          runtimeSystemId: 'arena-runtime',
          hasAuthoringPanel: true,
        },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/stores/app-notifications-store', () => ({
  notifySuccess: hoisted.notifySuccess,
  notifyError: hoisted.notifyError,
}));

import { ActiveGameModePicker } from '@/components/sidebar/active-game-mode-picker';

const sampleProject = (): ProjectManifest =>
  makeProjectManifest({
    id: makeProjectId('550e8400-e29b-41d4-a716-446655440020'),
    name: 'Demo',
  });

describe('ActiveGameModePicker', () => {
  beforeEach(() => {
    hoisted.updateProjectMutate.mockReset().mockResolvedValue(undefined);
    hoisted.notifySuccess.mockReset();
    hoisted.notifyError.mockReset();
    hoisted.projectHolder.current = sampleProject();
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults to the first discovered mode while no project selection is saved', () => {
    render(<ActiveGameModePicker projectId="project-1" />);

    expect(screen.getByTestId('active-game-mode-native-select')).toHaveProperty(
      'value',
      battleRoyalePluginId,
    );
  });

  it('persists a selected non-default mode under project.settings.activeGameMode', async () => {
    render(<ActiveGameModePicker projectId="project-1" />);

    fireEvent.change(screen.getByTestId('active-game-mode-native-select'), {
      target: { value: arenaPluginId },
    });

    await waitFor(() => expect(hoisted.updateProjectMutate).toHaveBeenCalledTimes(1));
    const input = hoisted.updateProjectMutate.mock.calls[0]?.[0] as {
      readonly project: ProjectManifest;
    };
    expect(input.project.settings?.activeGameMode).toBe(arenaPluginId);
    expect(hoisted.notifySuccess).toHaveBeenCalledWith('Active game mode set to Example Arena');
  });
});
