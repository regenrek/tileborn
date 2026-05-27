import { useEffect } from 'react';

import { isEditableTarget } from '@/editor/is-editable-target';
import { useEditorUiStore } from '@/stores/editor-ui-store';

import { zoomInFrom, zoomOutFrom } from './zoom.js';

const handleToolbarShortcut = (event: KeyboardEvent): void => {
  if (isEditableTarget(event.target)) {
    return;
  }
  if (!event.metaKey && !event.ctrlKey) {
    return;
  }

  const { camera, setCamera } = useEditorUiStore.getState();

  if (event.key === '=' || event.key === '+') {
    event.preventDefault();
    setCamera({ zoom: zoomInFrom(camera.zoom) });
    return;
  }
  if (event.key === '-') {
    event.preventDefault();
    setCamera({ zoom: zoomOutFrom(camera.zoom) });
    return;
  }
  if (event.key === '0') {
    event.preventDefault();
    setCamera({ zoom: 1 });
  }
};

export function useMapEditorToolbarShortcuts(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleToolbarShortcut);
    return () => window.removeEventListener('keydown', handleToolbarShortcut);
  }, []);
}
