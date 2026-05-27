import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useEditorUiStore } from '@/stores/editor-ui-store';

import { describeTabForPath, tabFromDescriptor } from './workspace-tabs';

/**
 * Mirrors the active route into the persisted openTabs list. Runs once on mount
 * and on every pathname change. Idempotent: re-visiting an already-open tab
 * does not duplicate it.
 */
export function useWorkspaceTabSync(): void {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const ensureTab = useEditorUiStore((state) => state.ensureTab);

  useEffect(() => {
    const descriptor = describeTabForPath(pathname);
    if (descriptor === null) return;
    ensureTab(tabFromDescriptor(descriptor));
  }, [pathname, ensureTab]);
}
