import type { RuntimeMenuSlot } from '@tileborne/plugin-api';
import type { ReactElement } from 'react';

import {
  sectionsForSlot,
  type MenuSectionProps,
  type MenuSectionRegistration,
} from '../contributions/menu-registry.js';

export interface SlotHostProps extends MenuSectionProps {
  readonly slot: RuntimeMenuSlot;
  readonly sections: readonly MenuSectionRegistration[];
}

/**
 * Renders all contributed sections for a named menu slot, in resolved order.
 * The shell mounts a `SlotHost` at each named slot; plugins/brands fill them.
 */
export function SlotHost({ slot, sections, ...sectionProps }: SlotHostProps): ReactElement | null {
  const resolved = sectionsForSlot(sections, slot);
  if (resolved.length === 0) {
    return null;
  }
  return (
    <div data-menu-slot={slot} className="tb-actions">
      {resolved.map(({ id, Component }) => (
        <Component key={id} {...sectionProps} />
      ))}
    </div>
  );
}
