import {
  Label,
  Switch,
  typography,
} from '@tileborne/ui';
import { Settings2Icon } from 'lucide-react';

import { useEditorUiStore } from '@/stores/editor-ui-store';

function OverlayToggle({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={id} className={typography.rowTitle}>
        {label}
      </Label>
      <Switch
        id={id}
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={hint}
      />
    </div>
  );
}

export function ViewportOverlaysSection() {
  const showGrid = useEditorUiStore((s) => s.showGrid);
  const setShowGrid = useEditorUiStore((s) => s.setShowGrid);
  const showCollisionOverlay = useEditorUiStore((s) => s.showCollisionOverlay);
  const setShowCollisionOverlay = useEditorUiStore((s) => s.setShowCollisionOverlay);
  const showDebugOverlay = useEditorUiStore((s) => s.showDebugOverlay);
  const setShowDebugOverlay = useEditorUiStore((s) => s.setShowDebugOverlay);
  const showMinimapOverlay = useEditorUiStore((s) => s.showMinimapOverlay);
  const setShowMinimapOverlay = useEditorUiStore((s) => s.setShowMinimapOverlay);

  return (
    <section
      className="space-y-1.5"
      data-testid="inspector-viewport-overlays-section"
    >
      <div className="flex items-center gap-2">
        <Settings2Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className={typography.panelTitle}>Viewport overlays</span>
      </div>
      <div className="space-y-1.5">
        <OverlayToggle
          id="overlay-grid"
          label="Grid"
          hint="Show map grid"
          checked={showGrid}
          onCheckedChange={setShowGrid}
        />
        <OverlayToggle
          id="overlay-collision"
          label="Collision"
          hint="Show collision masks"
          checked={showCollisionOverlay}
          onCheckedChange={setShowCollisionOverlay}
        />
        <OverlayToggle
          id="overlay-debug"
          label="Debug"
          hint="Show debug bounds and ids"
          checked={showDebugOverlay}
          onCheckedChange={setShowDebugOverlay}
        />
        <OverlayToggle
          id="overlay-minimap"
          label="Minimap"
          hint="Show minimap navigation overlay"
          checked={showMinimapOverlay}
          onCheckedChange={setShowMinimapOverlay}
        />
      </div>
    </section>
  );
}
