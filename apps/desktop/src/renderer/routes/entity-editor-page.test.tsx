// @vitest-environment jsdom

import {
  GameObjectType,
  VisualRefComponent,
  makeAssetId,
  makeGameObjectTypeId,
  makePackId,
  makePlaceableId,
  makeProjectId,
  makeTileId,
  type CategoryTag,
  type FamilyTag,
} from '@tileborne/core';
import {
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  TiledPlaceableSource,
  TilesetPack,
  TilesetPackAsset,
  TilesetPackLicense,
  UVRect,
} from '@tileborne/sdk-tileset/schemas';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Option, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrushIntent } from '@/stores/editor-ui-store';
import { documentLifecycle } from '@/lib/document-lifecycle';

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix}`;
const PROJECT_ID = makeProjectId(uuid('446655440030'));
const PACK_ID = makePackId(uuid('446655440031'));
const PLACEABLE_ID = makePlaceableId(uuid('446655440033'));
const PLUGIN_TYPE_ID = makeGameObjectTypeId(uuid('446655440040'));
const PROJECT_TYPE_ID = makeGameObjectTypeId(uuid('446655440041'));

const tilesetPackFixture = () =>
  new TilesetPack({
    schemaVersion: 1,
    id: PACK_ID,
    name: 'Test Pack',
    version: '1.0.0',
    license: new TilesetPackLicense({
      spdxId: 'CC0-1.0',
      attribution: Option.none(),
      sourceUrl: Option.none(),
      notes: Option.none(),
      redistributable: true,
    }),
    tilesets: [],
    assets: [
      new TilesetPackAsset({
        id: makeAssetId(uuid('446655440034')),
        path: 'objects/atlas.png',
        mime: 'image/png',
      }),
    ],
    placeables: [
      new Placeable({
        id: PLACEABLE_ID,
        name: 'Bow',
        size: new PlaceableSize({ width: 24, height: 48 }),
        frames: [
          new PlaceableFrameRef({
            assetId: makeAssetId(uuid('446655440034')),
            tileId: makeTileId(uuid('446655440035')),
            uv: new UVRect({ x: 0, y: 0, w: 24, h: 48 }),
            durationMs: Option.none(),
          }),
        ],
        tags: [],
        placementMode: 'object',
        source: new TiledPlaceableSource({
          format: 'tiled',
          tilesetName: 'objects',
          localTileId: 0,
          image: Option.some('objects/atlas.png'),
          imageWidth: Option.some(24),
          imageHeight: Option.some(48),
          objectType: Option.none(),
          objectClass: Option.none(),
          properties: {},
        }),
      }),
    ],
  });

const entityFixture = (id: typeof PLUGIN_TYPE_ID, label: string): GameObjectType =>
  new GameObjectType({
    id,
    schemaVersion: 1,
    label,
    family: 'obstacle' as FamilyTag,
    category: Option.some('gameplay' as CategoryTag),
    layerHint: Option.some('objects'),
    components: [
      new VisualRefComponent({
        placeableId: Option.some(PLACEABLE_ID),
        assetId: Option.none(),
        width: 48,
        height: 48,
        anchors: {},
      }),
    ],
    instanceDefaults: {},
  });

const hoisted = vi.hoisted(() => ({
  issuesHolder: { current: [] as readonly Record<string, unknown>[] },
  upsertMutate: vi.fn<(input: unknown) => Promise<{ saved: boolean; report: unknown }>>(),
  removeMutate: vi.fn<(input: unknown) => Promise<{ removed: boolean }>>(),
  brushIntentHolder: { current: { kind: 'eraser' } as BrushIntent },
  notifySuccess: vi.fn<(message: string) => void>(),
  notifyError: vi.fn<(message: string) => void>(),
  catalogHolder: { current: { objectTypes: [] as unknown[], lootTables: [], items: [] } },
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: PROJECT_ID }),
}));

vi.mock('@/hooks/queries', () => ({
  useResolvedCatalog: () => ({ data: hoisted.catalogHolder.current, isLoading: false }),
  useValidateCatalog: () => ({
    data: { report: { ok: hoisted.issuesHolder.current.length === 0, issues: hoisted.issuesHolder.current } },
  }),
  useTilesetPack: () => ({
    data: { id: PACK_ID, placeables: [{ id: PLACEABLE_ID, name: 'Bow' }] },
  }),
  useAssetPacks: () => ({
    data: { packs: [{ id: PACK_ID, name: 'Test Pack', integrityHash: 'hash-1' }] },
    isLoading: false,
  }),
  useTilesetPacks: (packIds: readonly string[]) =>
    packIds.map(() => ({ data: tilesetPackFixture(), isLoading: false })),
  useAssetPackLibrary: () => ({ data: undefined, isLoading: false }),
  useWorkingPalettePreviews: () => ({ previewByKey: new Map(), isLoading: false }),
}));

vi.mock('@/hooks/mutations', () => ({
  useUpsertCatalogType: () => ({ mutateAsync: hoisted.upsertMutate, isPending: false }),
  useRemoveCatalogType: () => ({ mutateAsync: hoisted.removeMutate, isPending: false }),
}));

vi.mock('@/stores/app-notifications-store', () => ({
  notifySuccess: hoisted.notifySuccess,
  notifyError: hoisted.notifyError,
}));

vi.mock('@/stores/editor-ui-store', () => {
  const useEditorUiStore = (selector: (value: { readonly brushIntent: BrushIntent }) => unknown) =>
    selector({ brushIntent: hoisted.brushIntentHolder.current });
  return { useEditorUiStore };
});

import { EntityEditorPage } from './entity-editor-page';

describe('EntityEditorPage', () => {
  beforeEach(() => {
    documentLifecycle.resetForTests();
    hoisted.catalogHolder.current = {
      objectTypes: [
        {
          objectType: entityFixture(PLUGIN_TYPE_ID, 'Plugin Tree'),
          origin: 'plugin',
          sourcePluginId: '@tileborne/plugin-test',
        },
        { objectType: entityFixture(PROJECT_TYPE_ID, 'My Crate'), origin: 'project' },
      ],
      lootTables: [],
      items: [],
    };
    hoisted.issuesHolder.current = [];
    hoisted.brushIntentHolder.current = { kind: 'eraser' } as BrushIntent;
    hoisted.upsertMutate.mockReset().mockResolvedValue({ saved: true, report: { ok: true, issues: [] } });
    hoisted.removeMutate.mockReset().mockResolvedValue({ removed: true });
    hoisted.notifySuccess.mockReset();
    hoisted.notifyError.mockReset();
  });

  afterEach(() => {
    cleanup();
    documentLifecycle.resetForTests();
  });

  it('lists merged catalog entities with origin badges', () => {
    render(<EntityEditorPage />);
    const pluginRow = screen.getByTestId(`entity-editor-row-${PLUGIN_TYPE_ID}`);
    const projectRow = screen.getByTestId(`entity-editor-row-${PROJECT_TYPE_ID}`);
    expect(pluginRow.textContent).toContain('Plugin Tree');
    expect(pluginRow.textContent).toContain('Plugin');
    expect(projectRow.textContent).toContain('My Crate');
    expect(projectRow.textContent).toContain('Project');
  });

  it('shows the assigned sprite as a resolved preview (name + pack + thumb) and on the canvas', () => {
    render(<EntityEditorPage />);
    fireEvent.click(screen.getByTestId(`entity-editor-row-${PROJECT_TYPE_ID}`).querySelector('button')!);

    const preview = screen.getByTestId('entity-visual-preview');
    expect(preview.textContent).toContain('Bow');
    expect(preview.textContent).toContain('Test Pack');
    // The geometry canvas renders the sprite crop as its background image.
    const stage = screen.getByTestId('sprite-geometry-stage');
    expect(stage.querySelector('image')?.getAttribute('href')).toContain('tileborne-asset://thumb');
  });

  it('keeps plugin entities read-only but offers duplicate-as-project-entity', async () => {
    render(<EntityEditorPage />);
    fireEvent.click(screen.getByTestId(`entity-editor-row-${PLUGIN_TYPE_ID}`).querySelector('button')!);

    expect((screen.getByTestId('entity-editor-save') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('entity-editor-delete') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('entity-editor-label') as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('entity-editor-duplicate'));
    await vi.waitFor(() => expect(hoisted.upsertMutate).toHaveBeenCalledTimes(1));
    const input = hoisted.upsertMutate.mock.calls[0]![0] as {
      projectId: string;
      objectTypeJson: { id: string; label: string };
    };
    expect(input.projectId).toBe(PROJECT_ID);
    expect(input.objectTypeJson.label).toBe('Plugin Tree (copy)');
    expect(input.objectTypeJson.id).not.toBe(String(PLUGIN_TYPE_ID));
  });

  it('edits and saves a project entity through catalog:upsertType', async () => {
    render(<EntityEditorPage />);
    fireEvent.click(screen.getByTestId(`entity-editor-row-${PROJECT_TYPE_ID}`).querySelector('button')!);

    fireEvent.change(screen.getByTestId('entity-editor-label'), { target: { value: 'Big Crate' } });
    fireEvent.click(screen.getByTestId('entity-editor-save'));

    await vi.waitFor(() => expect(hoisted.upsertMutate).toHaveBeenCalledTimes(1));
    const input = hoisted.upsertMutate.mock.calls[0]![0] as {
      objectTypeJson: unknown;
    };
    const decoded = Schema.decodeUnknownSync(GameObjectType)(input.objectTypeJson);
    expect(decoded.label).toBe('Big Crate');
    expect(hoisted.notifySuccess).toHaveBeenCalled();
  });

  it('routes the primary save through lifecycle saving and preserves a failed draft as error', async () => {
    let rejectSave!: (cause: Error) => void;
    hoisted.upsertMutate.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectSave = reject;
    }));
    render(<EntityEditorPage />);
    fireEvent.click(screen.getByTestId(`entity-editor-row-${PROJECT_TYPE_ID}`).querySelector('button')!);
    fireEvent.change(screen.getByTestId('entity-editor-label'), { target: { value: 'Unsaved Crate' } });
    fireEvent.click(screen.getByTestId('entity-editor-save'));

    await vi.waitFor(() => expect(screen.getByTestId('entity-document-status').textContent).toBe('saving'));
    rejectSave(new Error('catalog unavailable'));
    await vi.waitFor(() => expect(screen.getByTestId('entity-document-status').textContent).toBe('error'));
    expect((screen.getByTestId('entity-editor-label') as HTMLInputElement).value).toBe('Unsaved Crate');
    expect((screen.getByTestId('entity-editor-save') as HTMLButtonElement).disabled).toBe(false);
    expect(documentLifecycle.get(`entity-editor:${PROJECT_ID}`)).toMatchObject({
      status: 'error',
      hasRecovery: true,
    });
  });

  it('creates a new project entity and adds capabilities + anchors', async () => {
    render(<EntityEditorPage />);
    fireEvent.click(screen.getByTestId('entity-editor-new'));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Pistol' } });
    fireEvent.click(screen.getByTestId('entity-editor-create-confirm'));

    // New entity has no capabilities yet -> add visual-ref via the panel.
    fireEvent.change(screen.getByTestId('entity-capability-add-select'), {
      target: { value: 'visual-ref' },
    });
    fireEvent.click(screen.getByTestId('entity-capability-add'));
    expect(screen.getByTestId('entity-capability-visual-ref')).toBeTruthy();

    // Add a grip anchor on the entity.
    fireEvent.change(screen.getByTestId('entity-editor-anchor-name'), {
      target: { value: 'grip' },
    });
    fireEvent.click(screen.getByTestId('entity-editor-anchor-add'));
    expect(screen.getByTestId('entity-editor-anchor-grip')).toBeTruthy();

    fireEvent.click(screen.getByTestId('entity-editor-save'));
    await vi.waitFor(() => expect(hoisted.upsertMutate).toHaveBeenCalledTimes(1));
    const input = hoisted.upsertMutate.mock.calls[0]![0] as { objectTypeJson: unknown };
    const decoded = Schema.decodeUnknownSync(GameObjectType)(input.objectTypeJson);
    expect(decoded.label).toBe('Pistol');
    const visualRef = decoded.components.find((component) => component._tag === 'visual-ref');
    expect(visualRef).toBeDefined();
    expect((visualRef as VisualRefComponent).anchors['grip']).toBeDefined();
  });

  it('keeps a freshly created draft alive when another entity was selected before', () => {
    render(<EntityEditorPage />);
    // Select an existing entity first, then create a new one: the selection
    // sync must not wipe the unsaved draft (regression).
    fireEvent.click(screen.getByTestId(`entity-editor-row-${PROJECT_TYPE_ID}`).querySelector('button')!);
    fireEvent.click(screen.getByTestId('entity-editor-new'));
    fireEvent.change(document.getElementById('entity-create-label')!, {
      target: { value: 'Fresh Entity' },
    });
    fireEvent.click(screen.getByTestId('entity-editor-create-confirm'));

    expect((screen.getByTestId('entity-editor-label') as HTMLInputElement).value).toBe(
      'Fresh Entity',
    );
    expect((screen.getByTestId('entity-editor-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('surfaces validation issues for the selected entity and deletes via removeType', async () => {
    hoisted.issuesHolder.current = [
      {
        kind: 'unknown-reference',
        objectTypeId: String(PROJECT_TYPE_ID),
        refKind: 'weapon-ref.weaponId',
        missingId: 'weapon:x',
        message: 'references unknown weapon',
      },
    ];
    render(<EntityEditorPage />);
    fireEvent.click(screen.getByTestId(`entity-editor-row-${PROJECT_TYPE_ID}`).querySelector('button')!);

    expect(screen.getByTestId('entity-editor-issues').textContent).toContain(
      'references unknown weapon',
    );

    fireEvent.click(screen.getByTestId('entity-editor-delete'));
    await vi.waitFor(() => expect(hoisted.removeMutate).toHaveBeenCalledTimes(1));
    expect(hoisted.removeMutate.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      objectTypeId: String(PROJECT_TYPE_ID),
    });
  });
});
