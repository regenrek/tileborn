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

import { documentLifecycle } from '@/lib/document-lifecycle';

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
  });

const maxModel = (): PlayerModelRef =>
  new PlayerModelRef({
    ...model(),
    id: 'maltipoo-max',
    label: 'Maltipoo Max',
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
  searchHolder: { current: {} as { modelId?: string; path?: string } },
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: PROJECT_ID }),
  useSearch: () => hoisted.searchHolder.current,
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
  useWorkingPalettePreviews: () => ({ previewByKey: new Map() }),
}));

vi.mock('@/components/entity-editor/sprite-picker-dialog', () => ({
  SpritePickerDialog: ({ onSelect }: { onSelect: (selection: unknown) => void }) => (
    <button
      type="button"
      data-testid="player-model-test-relink-target"
      onClick={() =>
        onSelect({
          placeableId: 'placeable:relinked-hero',
          packId: 'pack:550e8400-e29b-41d4-a716-446655440199',
          name: 'Relinked Hero',
          width: 32,
          height: 32,
          clips: ['idle', 'walk', 'run', 'shoot', 'reload', 'hit', 'death', 'dash', 'pickup'].map(
            (name, index) => ({
              id: `clip:550e8400-e29b-41d4-a716-${String(446655440200 + index).padStart(12, '0')}`,
              name,
            }),
          ),
        })
      }
    >
      Pick relink target
    </button>
  ),
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
    documentLifecycle.resetForTests();
    hoisted.projectHolder.current = sampleProject();
    hoisted.modelsHolder.current = [model()];
    hoisted.applyModels.mockReset().mockImplementation((project: ProjectManifest) => project);
    hoisted.updateProjectMutate.mockReset().mockResolvedValue(undefined);
    hoisted.notifySuccess.mockReset();
    hoisted.notifyError.mockReset();
    hoisted.searchHolder.current = {};
  });

  afterEach(() => {
    cleanup();
    documentLifecycle.resetForTests();
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

  it('routes the primary save through lifecycle and leaves a rejected model dirty with error state', async () => {
    let rejectSave!: (cause: Error) => void;
    hoisted.updateProjectMutate.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    render(<PlayerModelEditorPage />);
    await waitFor(() => expect(screen.getByTestId('player-model-editor-label')).toBeTruthy());
    fireEvent.change(screen.getByTestId('player-model-editor-label'), {
      target: { value: 'Maltipoo Unsaved' },
    });
    fireEvent.click(screen.getByTestId('player-model-editor-save'));

    await waitFor(() =>
      expect(screen.getByTestId('player-model-document-status').textContent).toBe('saving'),
    );
    rejectSave(new Error('project write failed'));
    await waitFor(() =>
      expect(screen.getByTestId('player-model-document-status').textContent).toBe('error'),
    );
    expect((screen.getByTestId('player-model-editor-label') as HTMLInputElement).value).toBe(
      'Maltipoo Unsaved',
    );
    expect((screen.getByTestId('player-model-editor-save') as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(documentLifecycle.get(`player-model-editor:${PROJECT_ID}`)).toMatchObject({
      status: 'error',
      hasRecovery: true,
    });
  });

  it('persists a compatible relink with remapped semantic clips', async () => {
    render(<PlayerModelEditorPage />);

    await waitFor(() => expect(screen.getByTestId('player-model-editor-relink')).toBeTruthy());
    fireEvent.click(screen.getByTestId('player-model-editor-relink'));
    fireEvent.click(screen.getByTestId('player-model-test-relink-target'));
    fireEvent.click(screen.getByTestId('player-model-editor-save'));

    await waitFor(() => expect(hoisted.updateProjectMutate).toHaveBeenCalledTimes(1));
    const savedModels = hoisted.applyModels.mock.calls[0]?.[1] as readonly PlayerModelRef[];
    expect(savedModels[0]?.ref.refId).toBe('placeable:relinked-hero');
    expect(savedModels[0]?.clips.idle).toBe(savedModels[0]?.ref.clipId);
    expect(savedModels[0]?.clips.shoot).not.toBe(model().clips.shoot);
    expect(hoisted.notifySuccess).toHaveBeenCalledWith(
      'Relinked model to Relinked Hero; review geometry, then save.',
    );
  });

  it('opens an initially available non-default model on the exact route clip', async () => {
    hoisted.modelsHolder.current = [model(), maxModel()];
    hoisted.searchHolder.current = {
      modelId: 'maltipoo-max',
      path: 'playerModels.maltipoo-max.clips.run',
    };

    render(<PlayerModelEditorPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId('player-model-editor-row-maltipoo-max').getAttribute('aria-pressed'),
      ).toBe('true');
    });
    expect((screen.getByTestId('player-model-editor-label') as HTMLInputElement).value).toBe(
      'Maltipoo Max',
    );
    expect(screen.getByTestId('player-model-preview').textContent).toContain('Run');
    expect(screen.getByTestId('player-model-preview').textContent).toContain(String(clipIdAt(2)));
  });

  it('consumes a deferred model and clip target when the policy later provides it', async () => {
    hoisted.modelsHolder.current = [model()];
    hoisted.searchHolder.current = {
      modelId: 'maltipoo-max',
      path: 'playerModels.maltipoo-max.clips.run',
    };
    const { rerender } = render(<PlayerModelEditorPage />);

    await waitFor(() => {
      expect((screen.getByTestId('player-model-editor-label') as HTMLInputElement).value).toBe(
        'Maltipoo Mae',
      );
    });
    expect(screen.getByTestId('player-model-preview').textContent).toContain('Idle');

    hoisted.modelsHolder.current = [model(), maxModel()];
    hoisted.projectHolder.current = sampleProject();
    rerender(<PlayerModelEditorPage />);

    await waitFor(() => {
      expect((screen.getByTestId('player-model-editor-label') as HTMLInputElement).value).toBe(
        'Maltipoo Max',
      );
    });
    expect(screen.getByTestId('player-model-preview').textContent).toContain('Run');
    expect(screen.getByTestId('player-model-preview').textContent).toContain(String(clipIdAt(2)));
  });

  it('does not reapply a consumed route target after a manual model selection', async () => {
    hoisted.modelsHolder.current = [model(), maxModel()];
    hoisted.searchHolder.current = {
      modelId: 'maltipoo-max',
      path: 'playerModels.maltipoo-max.clips.run',
    };
    const { rerender } = render(<PlayerModelEditorPage />);

    await waitFor(() => {
      expect((screen.getByTestId('player-model-editor-label') as HTMLInputElement).value).toBe(
        'Maltipoo Max',
      );
    });
    fireEvent.click(screen.getByTestId('player-model-editor-row-maltipoo-mae'));
    expect((screen.getByTestId('player-model-editor-label') as HTMLInputElement).value).toBe(
      'Maltipoo Mae',
    );
    expect(screen.getByTestId('player-model-preview').textContent).toContain('Idle');

    hoisted.modelsHolder.current = [model(), maxModel()];
    hoisted.projectHolder.current = sampleProject();
    rerender(<PlayerModelEditorPage />);

    await waitFor(() => {
      expect((screen.getByTestId('player-model-editor-label') as HTMLInputElement).value).toBe(
        'Maltipoo Mae',
      );
    });
    expect(
      screen.getByTestId('player-model-editor-row-maltipoo-mae').getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
