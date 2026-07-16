import { CORE_HUD_WIDGETS } from '@tileborne/core';
import type { ComponentType } from 'react';

import type { HudWidgetProps } from './hud-overlay.js';

/**
 * A runtime registration pairing a custom HUD widget KIND with the React
 * component that renders it — the HUD sibling of `MenuSectionRegistration`
 * (ADR-0022/0027). Shipped-runtime plugins ship executable React per
 * ADR-0004; the app composes plugin widget registrations (+ brand extras)
 * into a flat list before mounting `RuntimeRoot` / `HudOverlay`.
 *
 * The editor playtest stays declarative-only (ADR-0001): it never executes
 * these registrations and renders custom kinds as movable placeholders in
 * HUD-edit mode instead.
 */
export interface HudWidgetRegistration {
  /**
   * The `HudWidgetPlacement.kind` this component renders, e.g.
   * `"arena.manaBar"`. Must be a namespaced dotted identifier and must NOT
   * use the engine-reserved `core.` namespace.
   */
  readonly kind: string;
  /** Origin tag, useful for debugging/boundary inspection. */
  readonly source?: 'plugin' | 'brand';
  readonly Component: ComponentType<HudWidgetProps>;
}

const RESERVED_KIND_PREFIX = 'core.';

const CORE_KINDS: ReadonlySet<string> = new Set(Object.values(CORE_HUD_WIDGETS));

/** Namespaced dotted identifier, mirroring the menu slot-id convention. */
const KIND_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/;

/**
 * Validate custom widget registrations. Returns human-readable violations
 * (empty = valid): duplicate kinds, malformed kind identifiers, and attempts
 * to claim the engine-reserved `core.` namespace (baseline widgets are owned
 * by the chassis and must render identically in editor and shipped client).
 * Apps should assert this at composition time (see `apps/game-client`).
 */
export const findInvalidHudWidgetRegistrations = (
  registrations: readonly HudWidgetRegistration[],
): readonly string[] => {
  const violations: string[] = [];
  const seen = new Map<string, number>();
  for (const registration of registrations) {
    seen.set(registration.kind, (seen.get(registration.kind) ?? 0) + 1);
    if (registration.kind.startsWith(RESERVED_KIND_PREFIX) || CORE_KINDS.has(registration.kind)) {
      violations.push(`reserved core kind: "${registration.kind}"`);
    } else if (!KIND_PATTERN.test(registration.kind)) {
      violations.push(
        `malformed kind (expected namespaced dotted identifier): "${registration.kind}"`,
      );
    }
  }
  for (const [kind, count] of seen) {
    if (count > 1) {
      violations.push(`duplicate kind: "${kind}" (${count} registrations)`);
    }
  }
  return violations;
};

/**
 * Resolve custom registrations into a kind→component map for the chassis.
 * Invalid entries (reserved `core.` kinds) are dropped defensively — the
 * baseline registry always wins for engine kinds; on duplicate custom kinds
 * the FIRST registration wins (stable, like menu sections). Pure — safe to
 * call during render.
 */
export const hudWidgetComponents = (
  registrations: readonly HudWidgetRegistration[],
): Readonly<Record<string, ComponentType<HudWidgetProps>>> => {
  const components: Record<string, ComponentType<HudWidgetProps>> = {};
  for (const registration of registrations) {
    if (registration.kind.startsWith(RESERVED_KIND_PREFIX) || CORE_KINDS.has(registration.kind)) {
      continue;
    }
    if (components[registration.kind] !== undefined) {
      continue;
    }
    components[registration.kind] = registration.Component;
  }
  return components;
};
