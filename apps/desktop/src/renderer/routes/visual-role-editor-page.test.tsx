// @vitest-environment jsdom

import {
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  makeClipId,
  makePackId,
  makePlaceableId,
  makeProjectId,
  makeProjectManifest,
  readProjectVisualAssetRoles,
  writeProjectVisualAssetRoles,
  type ProjectManifest,
} from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrushIntent } from '@/stores/editor-ui-store';
import { buildVisualAssetRoleRefFromPlaceable } from '@/lib/visual-asset-role-authoring';
import { PLUGIN_VISUAL_ROLE_POLICIES } from '@/lib/plugin-visual-role-policies';

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix}`;
const PROJECT_ID = makeProjectId(uuid('446655440030'));
const PACK_ID = makePackId(uuid('446655440031'));
const CLIP_ID = makeClipId(uuid('446655440032'));
const PLACEABLE_ID = makePlaceableId(uuid('446655440033'));
// Sourced from the policy contribution instead of a literal so the renderer
// shell stays free of plugin-id literals (runtime-renderer boundary).
const BR_PLUGIN_ID = PLUGIN_VISUAL_ROLE_POLICIES[0]!.pluginId;

const hoisted = vi.hoisted(() => ({
  projectHolder: { current: undefined as ProjectManifest | undefined },
  brushIntentHolder: { current: { kind: 'eraser' } as BrushIntent },
  updateProjectMutate: vi.fn<(input: unknown) => Promise<void>>(),
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
  usePluginsList: () => ({ data: { plugins: [{ id: BR_PLUGIN_ID, enabled: true }] } }),
  useTilesetPack: () => ({
    data: {
      id: PACK_ID,
      placeables: [
        {
          id: PLACEABLE_ID,
          name: 'Bow',
          clips: [{ id: CLIP_ID, name: 'shoot', frames: [], loop: true, defaultDurationMs: 100 }],
          source: {
            properties: {
              'tileborne.visual.scale': 0.52,
              'tileborne.visual.pivotX': 0.3,
              'tileborne.visual.pivotY': 0.58,
              'tileborne.visual.handX': 0.3,
              'tileborne.visual.handY': 0.58,
              'tileborne.visual.muzzleX': 0.94,
              'tileborne.visual.muzzleY': 0.48,
            },
          },
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

vi.mock('@/stores/editor-ui-store', () => {
  const useEditorUiStore = (selector: (value: { readonly brushIntent: BrushIntent }) => unknown) =>
    selector({ brushIntent: hoisted.brushIntentHolder.current });
  return {
    useEditorUiStore: Object.assign(useEditorUiStore, {
      getState: () => ({ brushIntent: hoisted.brushIntentHolder.current }),
    }),
  };
});

import { VisualRoleEditorPage } from './visual-role-editor-page';

const sampleProject = (): ProjectManifest =>
  makeProjectManifest({
    id: PROJECT_ID,
    name: 'Demo',
  });

const activeBowBrush = (): BrushIntent => ({
  kind: 'placeable',
  packId: PACK_ID,
  placeableId: PLACEABLE_ID,
  clipId: CLIP_ID,
});

const lastSavedProject = (): ProjectManifest => {
  const input = hoisted.updateProjectMutate.mock.calls.at(-1)?.[0] as
    | { readonly project: ProjectManifest }
    | undefined;
  if (input === undefined) {
    throw new Error('Expected project update mutation');
  }
  return input.project;
};

const inputValue = (testId: string): string =>
  (screen.getByTestId(testId) as HTMLInputElement).value;

describe('VisualRoleEditorPage', () => {
  beforeEach(() => {
    hoisted.projectHolder.current = sampleProject();
    hoisted.brushIntentHolder.current = activeBowBrush();
    hoisted.updateProjectMutate.mockReset().mockResolvedValue(undefined);
    hoisted.notifySuccess.mockReset();
    hoisted.notifyError.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('persists edited render scale and weapon anchor transforms as a project override', async () => {
    render(<VisualRoleEditorPage />);

    await waitFor(() =>
      expect(inputValue('visual-role-editor-label')).toBe('Pulse Carbine'),
    );

    fireEvent.change(screen.getByTestId('visual-role-editor-scale'), {
      target: { value: '0.61' },
    });
    fireEvent.change(screen.getByTestId('visual-role-editor-anchor-muzzle-rotation'), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByTestId('visual-role-editor-anchor-muzzle-z'), {
      target: { value: '3' },
    });
    expect(
      screen
        .getByRole('img', { name: 'Weapon attachment preview' })
        .getAttribute('data-angle'),
    ).toBe('12.00');
    fireEvent.click(screen.getByTestId('visual-role-editor-save'));

    await waitFor(() => expect(hoisted.updateProjectMutate).toHaveBeenCalledTimes(1));
    const [role] = readProjectVisualAssetRoles(lastSavedProject());

    expect(role?.roleKind).toBe(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon);
    expect(role?.renderProfile.scale).toBe(0.61);
    expect(role?.anchors.muzzle?.rotationDeg).toBe(12);
    expect(role?.anchors.muzzle?.zOffset).toBe(3);
    expect(hoisted.notifySuccess).toHaveBeenCalledWith('Equipped weapon saved');
  });

  it('uses the active palette asset as the selected role draft before saving', async () => {
    render(<VisualRoleEditorPage />);

    fireEvent.click(screen.getByTestId('visual-role-editor-use-active'));
    await waitFor(() => expect(inputValue('visual-role-editor-label')).toBe('Bow / shoot'));

    fireEvent.click(screen.getByTestId('visual-role-editor-save'));

    await waitFor(() => expect(hoisted.updateProjectMutate).toHaveBeenCalledTimes(1));
    const [role] = readProjectVisualAssetRoles(lastSavedProject());

    expect(role?.label).toBe('Bow / shoot');
    expect(role?.ref.kind).toBe('sprite');
    expect(role?.ref.clipId).toBe(CLIP_ID);
    expect(role?.renderProfile.scale).toBe(0.52);
    expect(role?.anchors.hand?.point).toEqual({ x: 0.3, y: 0.58 });
    expect(role?.anchors.muzzle?.point).toEqual({ x: 0.94, y: 0.48 });
  });

  it('removes a project visual role override from project settings', async () => {
    const role = buildVisualAssetRoleRefFromPlaceable({
      roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
      roleLabel: 'Equipped weapon',
      assetLabel: 'Bow / shoot',
      activePlaceable: { packId: PACK_ID, placeableId: PLACEABLE_ID, clipId: CLIP_ID },
    });
    hoisted.projectHolder.current = writeProjectVisualAssetRoles(sampleProject(), [role]);

    render(<VisualRoleEditorPage />);

    await waitFor(() =>
      expect((screen.getByTestId('visual-role-editor-remove') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByTestId('visual-role-editor-remove'));

    await waitFor(() => expect(hoisted.updateProjectMutate).toHaveBeenCalledTimes(1));
    expect(readProjectVisualAssetRoles(lastSavedProject())).toEqual([]);
    expect(hoisted.notifySuccess).toHaveBeenCalledWith('Equipped weapon override removed');
  });
});
