import type { RuntimeMenuSlot } from '@tileborne/plugin-api';
import type { ComponentType } from 'react';

/**
 * Props passed to every contributed menu section. Brand- and plugin-neutral:
 * sections receive the menu dispatcher + the active brand title only. The
 * dispatch surface is intentionally narrow so sections cannot drive arbitrary
 * state machine transitions beyond the documented menu events.
 */
export interface MenuSectionProps {
  /** Request the shell to start a match flow (menu -> lobby). */
  readonly onPlay: () => void;
  /** Close the current menu surface / go back one screen. */
  readonly onBack: () => void;
  /** Brand title for copy that needs it (kept neutral by default). */
  readonly title: string;
}

/**
 * A runtime registration pairing a contribution/extension id with the React
 * component that renders it. Shipped-runtime plugins ship executable React per
 * ADR-0004; the app composes plugin sections + brand `menuExtensions` into a
 * flat list before mounting the shell.
 */
export interface MenuSectionRegistration {
  readonly id: string;
  readonly slot: RuntimeMenuSlot;
  /** Lower order renders first; missing order sorts after explicit orders. */
  readonly order?: number;
  /** Origin tag, useful for debugging/boundary inspection. */
  readonly source?: 'plugin' | 'brand';
  readonly Component: ComponentType<MenuSectionProps>;
}

const orderOf = (registration: MenuSectionRegistration): number =>
  registration.order ?? Number.MAX_SAFE_INTEGER;

/**
 * Resolve the ordered list of sections for a slot. Stable: equal orders keep
 * registration order. Pure — safe to call during render.
 */
export const sectionsForSlot = (
  registrations: readonly MenuSectionRegistration[],
  slot: RuntimeMenuSlot,
): readonly MenuSectionRegistration[] =>
  registrations
    .map((registration, index) => ({ registration, index }))
    .filter((entry) => entry.registration.slot === slot)
    .sort((a, b) => orderOf(a.registration) - orderOf(b.registration) || a.index - b.index)
    .map((entry) => entry.registration);

/** Detect duplicate registration ids within a single slot. */
export const findDuplicateSectionIds = (
  registrations: readonly MenuSectionRegistration[],
): readonly string[] => {
  const seen = new Map<string, number>();
  for (const registration of registrations) {
    const key = `${registration.slot}:${registration.id}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
};
