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

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix}`;
const PROJECT_ID = makeProjectId(uuid('446655440010'));
const PACK_ID = makePackId(uuid('446655440011'));
const CLIP_ID = makeClipId(uuid('446655440012'));
const PLACEABLE_ID = makePlaceableId(uuid('446655440013'));

const hoisted = vi.hoisted(() => ({
  projectHolder: { current: undefined as ProjectManifest | undefined },
  brushIntentHolder: { current: { kind: 'eraser' } as BrushIntent },
  updateProjectMutate: vi.fn<(input: unknown) => Promise<void>>(),
  notifySuccess: vi.fn<(message: string) => void>(),
  notifyError: vi.fn<(message: string) => void>(),
}));

vi.mock('@/hooks/queries', () => ({
  useProject: () => ({
    data:
      hoisted.projectHolder.current === undefined
        ? undefined
        : { project: hoisted.projectHolder.current },
  }),
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

import { VisualAssetRolesSection } from '@/components/plugins/visual-asset-roles-section';

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

describe('VisualAssetRolesSection', () => {
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

  it('assigns the active sprite brush to a project visual role', async () => {
    render(<VisualAssetRolesSection projectId={PROJECT_ID} />);

    expect(screen.getByText('Bow / shoot')).toBeTruthy();
    expect(screen.getByText('Default: Pulse Carbine')).toBeTruthy();
    fireEvent.click(screen.getByTestId('visual-role-equipped-weapon-use-active'));

    await waitFor(() => expect(hoisted.updateProjectMutate).toHaveBeenCalledTimes(1));
    const input = hoisted.updateProjectMutate.mock.calls[0]?.[0] as {
      readonly project: ProjectManifest;
    };
    const [role] = readProjectVisualAssetRoles(input.project);

    expect(role?.roleKind).toBe(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon);
    expect(role?.label).toBe('Bow / shoot');
    expect(role?.ref.kind).toBe('sprite');
    expect(role?.ref.clipId).toBe(CLIP_ID);
    expect(role?.renderProfile.scale).toBe(0.52);
    expect(role?.anchors.muzzle?.point).toEqual({ x: 0.94, y: 0.48 });
    expect(hoisted.notifySuccess).toHaveBeenCalledWith('Equipped weapon visual role saved');
  });

  it('removes an assigned visual role from project settings', async () => {
    const role = buildVisualAssetRoleRefFromPlaceable({
      roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
      roleLabel: 'Equipped weapon',
      assetLabel: 'Bow / shoot',
      activePlaceable: { packId: PACK_ID, placeableId: PLACEABLE_ID, clipId: CLIP_ID },
    });
    hoisted.projectHolder.current = writeProjectVisualAssetRoles(sampleProject(), [role]);

    render(<VisualAssetRolesSection projectId={PROJECT_ID} />);
    fireEvent.click(screen.getByTestId('visual-role-equipped-weapon-remove'));

    await waitFor(() => expect(hoisted.updateProjectMutate).toHaveBeenCalledTimes(1));
    const input = hoisted.updateProjectMutate.mock.calls[0]?.[0] as {
      readonly project: ProjectManifest;
    };

    expect(readProjectVisualAssetRoles(input.project)).toEqual([]);
    expect(hoisted.notifySuccess).toHaveBeenCalledWith('Equipped weapon visual role removed');
  });
});
