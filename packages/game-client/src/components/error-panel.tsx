import { Button } from '@tileborne/ui';
import type { ReactElement } from 'react';

import type { MenuError } from '../state/menu-machine.js';

export interface ErrorPanelProps {
  readonly error: MenuError;
  readonly onDismiss: () => void;
}

/** Runtime error panel (boot failure, disconnect, etc.). */
export function ErrorPanel({ error, onDismiss }: ErrorPanelProps): ReactElement {
  return (
    <div className="tb-scrim">
      <div
        className="tb-panel tb-error"
        role="alertdialog"
        aria-label={error.title}
        data-testid="error-panel"
      >
        <h2 className="tb-title">{error.title}</h2>
        <p className="tb-tagline">{error.message}</p>
        <div className="tb-actions">
          <Button variant="outline" onClick={onDismiss}>
            Back to menu
          </Button>
        </div>
      </div>
    </div>
  );
}
