import { useEffect } from 'react';

import { READINESS_PROBLEMS_EVENT } from '@/lib/readiness-gate';
import { useEditorUiStore } from '@/stores/editor-ui-store';

/** Always-mounted AppShell owner for opening and targeting the Problems drawer. */
export function useReadinessProblemsOwner(): void {
  const setBottomDrawerOpen = useEditorUiStore((state) => state.setBottomDrawerOpen);
  const setBottomDrawerTab = useEditorUiStore((state) => state.setBottomDrawerTab);

  useEffect(() => {
    const showProblems = () => {
      setBottomDrawerTab('problems');
      setBottomDrawerOpen(true);
    };
    window.addEventListener(READINESS_PROBLEMS_EVENT, showProblems);
    return () => window.removeEventListener(READINESS_PROBLEMS_EVENT, showProblems);
  }, [setBottomDrawerOpen, setBottomDrawerTab]);
}
