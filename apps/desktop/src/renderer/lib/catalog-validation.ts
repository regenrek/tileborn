import type { TileborneMap } from '@tileborne/core';
import type { CatalogValidationIssue } from '@tileborne/ipc-contracts';

/** The structured issue kinds carried by `CatalogValidationReport` (ADR-0025). */
export type ValidationIssueKind = CatalogValidationIssue['kind'];

/**
 * Deterministic display order for the issue groups. Mirrors the order the
 * `validateCatalog` errors are conceptually layered (structural duplicates →
 * dangling references → softer coherence checks) so the drawer is stable.
 */
export const VALIDATION_ISSUE_KIND_ORDER: readonly ValidationIssueKind[] = [
  'duplicate-type',
  'unknown-reference',
  'coherence',
];

/** Human-readable group headings, keyed purely on the engine issue kind. */
export const VALIDATION_ISSUE_KIND_LABEL: Record<ValidationIssueKind, string> = {
  'duplicate-type': 'Duplicate types',
  'unknown-reference': 'Unknown references',
  coherence: 'Coherence',
};

export interface ValidationIssueGroup {
  readonly kind: ValidationIssueKind;
  readonly label: string;
  readonly issues: readonly CatalogValidationIssue[];
}

/**
 * Bucket the report's issues by their `kind` into the deterministically ordered,
 * non-empty groups the drawer renders. Issues keep their report order within a
 * group; unknown/extra kinds (forward-compat) are appended after the known ones.
 */
export const groupValidationIssues = (
  issues: readonly CatalogValidationIssue[],
): readonly ValidationIssueGroup[] => {
  const byKind = new Map<ValidationIssueKind, CatalogValidationIssue[]>();
  for (const issue of issues) {
    const bucket = byKind.get(issue.kind);
    if (bucket === undefined) {
      byKind.set(issue.kind, [issue]);
    } else {
      bucket.push(issue);
    }
  }

  const orderedKnown = VALIDATION_ISSUE_KIND_ORDER.filter((kind) => byKind.has(kind));
  const extras = [...byKind.keys()].filter((kind) => !VALIDATION_ISSUE_KIND_ORDER.includes(kind));

  return [...orderedKnown, ...extras].map((kind) => ({
    kind,
    label: VALIDATION_ISSUE_KIND_LABEL[kind] ?? kind,
    issues: byKind.get(kind) ?? [],
  }));
};

/**
 * Where clicking a validation issue navigates. Best-effort/simple (full
 * diagnostics deep-linking is P1):
 *
 * - `object` — a placed `MapObject` of the offending type exists on the open
 *   map; selecting it surfaces it in the inspector.
 * - `palette` — the issue references an object type but none is placed yet;
 *   the type is surfaced as the active catalog-object brush in the palette.
 * - `none` — the issue carries no `objectTypeId` (e.g. a bare coherence note),
 *   so there is no navigable context.
 */
export type ValidationNavigationTarget =
  | { readonly kind: 'object'; readonly objectId: string; readonly objectTypeId: string }
  | { readonly kind: 'palette'; readonly objectTypeId: string }
  | { readonly kind: 'none' };

/**
 * Resolve the navigation target for an issue against the open map. Prefers a
 * placed object of the referenced type, then falls back to surfacing the type
 * in the palette, then to no navigation when the issue carries no type id.
 */
export const resolveValidationNavigation = (
  issue: CatalogValidationIssue,
  map: TileborneMap | undefined,
): ValidationNavigationTarget => {
  const objectTypeId = issue.objectTypeId;
  if (objectTypeId === undefined) {
    return { kind: 'none' };
  }
  const placed = map?.objects.find((object) => object.kind === objectTypeId);
  if (placed !== undefined) {
    return { kind: 'object', objectId: placed.id, objectTypeId };
  }
  return { kind: 'palette', objectTypeId };
};
