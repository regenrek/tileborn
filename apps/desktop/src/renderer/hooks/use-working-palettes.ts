import { useShallow } from 'zustand/react/shallow';
import { useEffect } from 'react';

import type { WorkingPalette, WorkingPaletteItemDraft } from '@/lib/working-palettes-bridge';
import { useWorkingPalettesStore } from '@/stores/working-palettes-store';

export interface WorkingPalettesScope {
  readonly projectId: string | null | undefined;
}

export function useWorkingPalettes(scope: WorkingPalettesScope): readonly WorkingPalette[] {
  useEffect(() => {
    void useWorkingPalettesStore.getState().load({ projectId: scope.projectId ?? null });
  }, [scope.projectId]);

  return useWorkingPalettesStore(
    useShallow((state) => state.list({ projectId: scope.projectId ?? null })),
  );
}

export function useActiveWorkingPalette(
  projectId: string | null | undefined,
): WorkingPalette | undefined {
  useEffect(() => {
    void useWorkingPalettesStore.getState().load({ projectId: projectId ?? null });
  }, [projectId]);

  return useWorkingPalettesStore((state) => state.getActive({ projectId: projectId ?? null }));
}

export function useWorkingPaletteActions() {
  return useWorkingPalettesStore(
    useShallow((state) => ({
      create: state.create,
      update: state.update,
      remove: state.remove,
      setActive: state.setActive,
      addItems: state.addItems,
      removeItem: state.removeItem,
      reorderItems: state.reorderItems,
    })),
  );
}

/**
 * Ensure a palette exists for `(projectId, packId)` and return it. If none
 * exist, lazily create a "Working palette" with the provided seed items. The
 * resulting palette is set as active for the scope.
 */
export async function ensureWorkingPalette(args: {
  readonly projectId: string | null | undefined;
  readonly seedItems?: readonly WorkingPaletteItemDraft[];
  readonly name?: string;
}): Promise<WorkingPalette> {
  const store = useWorkingPalettesStore.getState();
  const scope = { projectId: args.projectId ?? null };
  await store.load(scope);
  const existing = store.list(scope);
  if (existing.length > 0) {
    const active = store.getActive({ projectId: scope.projectId });
    const target = active ?? existing[0]!;
    await store.setActive({ projectId: scope.projectId, paletteId: target.id });
    return target;
  }
  const created = await store.create({
    projectId: scope.projectId,
    name: args.name ?? 'Working palette',
    items: args.seedItems,
  });
  await store.setActive({ projectId: scope.projectId, paletteId: created.id });
  return created;
}
