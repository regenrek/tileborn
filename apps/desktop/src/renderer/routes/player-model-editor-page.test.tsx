// @vitest-environment jsdom

import {
  AssetLibraryReference,
  PlayerModelClipSet,
  PlayerModelRef,
  makeClipId,
  makePackId,
  makeProjectId,
  makeProjectManifest,
  type ProjectManifest,
} from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix}`;
const PROJECT_ID = makeProjectId(uuid('446655440130'));
const PACK_ID = makePackId(uuid('446655440131'));
const PLACEABLE_ID = 'placeable:maltipoo';
const idleClipId = makeClipId(uuid('446655440140'));
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544014${index}`);

const clips = () =>
  new PlayerModelClipSet({
    idle: idleClipId,
    walk: clipIdAt(1),
    run: clipIdAt(2),
    shoot: clipIdAt(3),
    reload: clipIdAt(4),
    hit: clipIdAt(5),
    death: clipIdAt(6),
    dash: clipIdAt(7),
    pickup: clipIdAt(8),
  });

const model = (): PlayerModelRef =>
  new PlayerModelRef({
    id: 'maltipoo-mae',
    label: 'Maltipoo Mae',
    ref: new AssetLibraryReference({
      packId: PACK_ID,
      kind: 'sprite',
      refId: PLACEABLE_ID,
      clipId: idleClipId,
    }),
    defaultClipId: idleClipId,
    clips: clips(),
    anchor: { x: 0.5, y: 0.86 },
    hitbox: { x: 0.28, y: 0.18, width: 0.44, height: 0.66 },
    muzzle: { x: 0.8, y: 0.52 },
  });

const sampleProject = (): ProjectManifest =>
  makeProjectManifest({
    id: PROJECT_ID,
    name: 'Demo',
  });

const hoisted = vi.hoisted(() => ({
  projectHolder: { current: undefined as ProjectManifest | undefined },
  modelsHolder: { current: [] as PlayerModelRef[] },
  updateProjectMutate: vi.fn<(input: unknown) => Promise<void>>(),
  applyModels: vi.fn<
    (project: ProjectManifest, models: readonly PlayerModelRef[]) => ProjectManifest
  >((project) => project),
  notifySuccess: vi.fn<(message: string) => void>(),
  notifyError: vi.fn<(message: string) => void>(),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: PROJECT_ID }),
}));

vi.mock('@/hooks/queries', () => ({
  useProject: () => ({
    data:
      hoisted.projectHolder.current === undefined
        ? undefined
        : { project: hoisted.projectHolder.current },
  }),
  useMaps: () => ({ data: { maps: [{ id: 'map:one' }] } }),
  useMap: () => ({ data: { map: { id: 'map:one' } } }),
  usePluginsList: () => ({ data: { plugins: [{ id: 'test-plugin', enabled: true }] } }),
  useTilesetPack: () => ({
    data: {
      id: PACK_ID,
      assets: [],
      placeables: [
        {
          id: PLACEABLE_ID,
          name: 'Maltipoo',
          clips: [
            { id: idleClipId, name: 'idle', frames: [], loop: true, defaultDurationMs: 100 },
            ...Array.from({ length: 8 }, (_, index) => ({
              id: clipIdAt(index + 1),
              name: ['walk', 'run', 'shoot', 'reload', 'hit', 'death', 'dash', 'pickup'][index],
              frames: [],
              loop: true,
              defaultDurationMs: 100,
            })),
          ],
          source: { properties: {} },
        },
      ],
    } as unknown as TilesetPack,
  }),
}));

vi.mock('@/hooks/mutations', () => ({
  useUpdateProject: () => ({ mutateAsync: hoisted.updateProjectMutate, isPending: false }),
}));

vi.mock('@/stores/app-notifications-store', () => ({
  notifySuccess: hoisted.notifySuccess,
  notifyError: hoisted.notifyError,
}));

vi.mock('@/lib/plugin-player-model-policies', () => ({
  PLUGIN_PLAYER_MODEL_POLICIES: [
    {
      pluginId: 'test-plugin',
      mode: 'selectable',
      resolveModels: () => hoisted.modelsHolder.current,
      applyModels: hoisted.applyModels,
    },
  ],
}));

import { PlayerModelEditorPage } from './player-model-editor-page';

describe('PlayerModelEditorPage', () => {
  beforeEach(() => {
    hoisted.projectHolder.current = sampleProject();
    hoisted.modelsHolder.current = [model()];
    hoisted.applyModels
      .mockReset()
      .mockImplementation((project: ProjectManifest) => project);
    hoisted.updateProjectMutate.mockReset().mockResolvedValue(undefined);
    hoisted.notifySuccess.mockReset();
    hoisted.notifyError.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('persists edited model metadata through the active player model policy', async () => {
    render(<PlayerModelEditorPage />);

    await waitFor(() =>
      expect((screen.getByTestId('player-model-editor-label') as HTMLInputElement).value).toBe(
        'Maltipoo Mae',
      ),
    );

    fireEvent.change(screen.getByTestId('player-model-editor-label'), {
      target: { value: 'Maltipoo Mae Tuned' },
    });
    fireEvent.change(screen.getByTestId('player-model-editor-render-scale'), {
      target: { value: '1.25' },
    });
    fireEvent.change(screen.getByTestId('player-model-editor-world-width'), {
      target: { value: '28' },
    });
    fireEvent.change(screen.getByTestId('player-model-editor-clip-shoot'), {
      target: { value: String(clipIdAt(4)) },
    });
    fireEvent.click(screen.getByTestId('player-model-editor-save'));

    await waitFor(() => expect(hoisted.updateProjectMutate).toHaveBeenCalledTimes(1));
    expect(hoisted.applyModels).toHaveBeenCalledTimes(1);
    const savedModels = hoisted.applyModels.mock.calls[0]?.[1] as readonly PlayerModelRef[];
    expect(savedModels[0]?.label).toBe('Maltipoo Mae Tuned');
    expect(savedModels[0]?.renderScale).toBe(1.25);
    expect(savedModels[0]?.worldSize).toEqual({ width: 28, height: 32 });
    expect(savedModels[0]?.clips.shoot).toBe(clipIdAt(4));
    expect(hoisted.notifySuccess).toHaveBeenCalledWith('Maltipoo Mae Tuned saved');
  });
});
