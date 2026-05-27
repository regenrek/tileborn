import type {
  ProjectId,
  WorkingPalette,
  WorkingPaletteId,
  WorkingPaletteItemId,
} from '@tileborne/core';
import { create } from 'zustand';

import { invokeIpc } from '@/lib/ipc';
import type { WorkingPaletteItemDraft } from '@/lib/working-palettes-bridge';

interface WorkingPalettesState {
  readonly palettes: readonly WorkingPalette[];
  readonly activePaletteId: WorkingPaletteId | undefined;
  readonly loadedProjectId: string | null | undefined;
  readonly isLoading: boolean;
  readonly error: unknown;
}

interface WorkingPalettesActions {
  load(scope: ProjectScope): Promise<void>;
  list(scope: ListScope): readonly WorkingPalette[];
  getActive(scope: { projectId?: string | null }): WorkingPalette | undefined;
  create(input: CreateInput): Promise<WorkingPalette>;
  update(input: UpdateInput): Promise<WorkingPalette>;
  remove(input: RemoveInput): Promise<void>;
  setActive(input: SetActiveInput): Promise<WorkingPalette>;
  addItems(input: AddItemsInput): Promise<WorkingPalette>;
  removeItem(input: RemoveItemInput): Promise<WorkingPalette>;
  reorderItems(input: ReorderItemsInput): Promise<WorkingPalette>;
  prunePackReferences(packId: string): void;
  /** Test-only helper. Resets the in-memory store. */
  __resetForTests(): void;
}

export interface WorkingPalettesProjectScope {
  readonly projectId?: string | null | undefined;
}

export interface WorkingPalettesListScope {
  readonly projectId?: string | null | undefined;
}

export interface WorkingPalettesCreateInput {
  readonly projectId?: string | null | undefined;
  readonly name: string;
  readonly items?: readonly WorkingPaletteItemDraft[] | undefined;
}

export interface WorkingPalettesUpdateInput {
  readonly projectId?: string | null | undefined;
  readonly paletteId: string;
  readonly name?: string | undefined;
  readonly items?: readonly WorkingPaletteItemDraft[] | undefined;
}

export interface WorkingPalettesRemoveInput {
  readonly projectId?: string | null | undefined;
  readonly paletteId: string;
}

export interface WorkingPalettesSetActiveInput {
  readonly projectId?: string | null | undefined;
  readonly paletteId: string;
}

export interface WorkingPalettesAddItemsInput {
  readonly projectId?: string | null | undefined;
  readonly paletteId: string;
  readonly items: readonly WorkingPaletteItemDraft[];
}

export interface WorkingPalettesRemoveItemInput {
  readonly projectId?: string | null | undefined;
  readonly paletteId: string;
  readonly itemId: string;
}

export interface WorkingPalettesReorderItemsInput {
  readonly projectId?: string | null | undefined;
  readonly paletteId: string;
  readonly itemIds: readonly string[];
}

type ProjectScope = WorkingPalettesProjectScope;
type ListScope = WorkingPalettesListScope;
type CreateInput = WorkingPalettesCreateInput;
type UpdateInput = WorkingPalettesUpdateInput;
type RemoveInput = WorkingPalettesRemoveInput;
type SetActiveInput = WorkingPalettesSetActiveInput;
type AddItemsInput = WorkingPalettesAddItemsInput;
type RemoveItemInput = WorkingPalettesRemoveItemInput;
type ReorderItemsInput = WorkingPalettesReorderItemsInput;

const projectIdForScope = (projectId: string | null | undefined): string | null =>
  projectId === undefined || projectId === null || projectId.length === 0 ? null : projectId;

const projectRequest = (
  projectId: string | null | undefined,
): { readonly projectId?: ProjectId | undefined } => {
  const scopedProjectId = projectIdForScope(projectId);
  return scopedProjectId === null ? {} : { projectId: scopedProjectId as ProjectId };
};

const reload = async (
  set: (
    partial:
      | Partial<WorkingPalettesState>
      | ((state: WorkingPalettesState & WorkingPalettesActions) => Partial<WorkingPalettesState>),
  ) => void,
  projectId: string | null | undefined,
): Promise<void> => {
  const scopedProjectId = projectIdForScope(projectId);
  set({ isLoading: true, error: undefined });
  try {
    const response = await invokeIpc(() =>
      window.tileborne.workingPalettes.list(projectRequest(scopedProjectId)),
    );
    set({
      palettes: response.palettes,
      activePaletteId: response.activePaletteId,
      loadedProjectId: scopedProjectId,
      isLoading: false,
      error: undefined,
    });
  } catch (error) {
    set({ isLoading: false, error });
    throw error;
  }
};

const initialState: WorkingPalettesState = {
  palettes: [],
  activePaletteId: undefined,
  loadedProjectId: undefined,
  isLoading: false,
  error: undefined,
};

export const useWorkingPalettesStore = create<WorkingPalettesState & WorkingPalettesActions>()(
  (set, get) => ({
    ...initialState,

    async load({ projectId }) {
      await reload(set, projectId);
    },

    list({ projectId }) {
      const scopedProjectId = projectIdForScope(projectId);
      return get()
        .palettes.filter((palette) => projectIdForScope(palette.projectId) === scopedProjectId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },

    getActive({ projectId }) {
      const scopedProjectId = projectIdForScope(projectId);
      const activeId = get().activePaletteId;
      return get().palettes.find(
        (palette) =>
          palette.id === activeId && projectIdForScope(palette.projectId) === scopedProjectId,
      );
    },

    async create({ projectId, name, items }) {
      const response = await invokeIpc(() =>
        window.tileborne.workingPalettes.create({
          ...projectRequest(projectId),
          name: name.trim().length === 0 ? 'Working palette' : name.trim(),
          items,
        }),
      );
      await reload(set, projectId);
      return response.palette;
    },

    async update({ projectId, paletteId, name, items }) {
      const response = await invokeIpc(() =>
        window.tileborne.workingPalettes.update({
          ...projectRequest(projectId),
          paletteId: paletteId as WorkingPaletteId,
          ...(name === undefined ? {} : { name }),
          ...(items === undefined ? {} : { items }),
        }),
      );
      await reload(set, projectId);
      return response.palette;
    },

    async remove({ projectId, paletteId }) {
      await invokeIpc(() =>
        window.tileborne.workingPalettes.delete({
          ...projectRequest(projectId),
          paletteId: paletteId as WorkingPaletteId,
        }),
      );
      await reload(set, projectId);
    },

    async setActive({ projectId, paletteId }) {
      const response = await invokeIpc(() =>
        window.tileborne.workingPalettes.setActive({
          ...projectRequest(projectId),
          paletteId: paletteId as WorkingPaletteId,
        }),
      );
      await reload(set, projectId);
      return response.palette;
    },

    async addItems({ projectId, paletteId, items }) {
      const response = await invokeIpc(() =>
        window.tileborne.workingPalettes.addItems({
          ...projectRequest(projectId),
          paletteId: paletteId as WorkingPaletteId,
          items,
        }),
      );
      await reload(set, projectId);
      return response.palette;
    },

    async removeItem({ projectId, paletteId, itemId }) {
      const response = await invokeIpc(() =>
        window.tileborne.workingPalettes.removeItem({
          ...projectRequest(projectId),
          paletteId: paletteId as WorkingPaletteId,
          itemId: itemId as WorkingPaletteItemId,
        }),
      );
      await reload(set, projectId);
      return response.palette;
    },

    async reorderItems({ projectId, paletteId, itemIds }) {
      const response = await invokeIpc(() =>
        window.tileborne.workingPalettes.reorderItems({
          ...projectRequest(projectId),
          paletteId: paletteId as WorkingPaletteId,
          itemIds: itemIds as readonly WorkingPaletteItemId[],
        }),
      );
      await reload(set, projectId);
      return response.palette;
    },

    prunePackReferences(packId) {
      set((state) => ({
        palettes: state.palettes.map((palette) => ({
          ...palette,
          items: palette.items.filter((item) => item.ref.packId !== packId),
        })),
      }));
    },

    __resetForTests() {
      set(initialState);
    },
  }),
);
