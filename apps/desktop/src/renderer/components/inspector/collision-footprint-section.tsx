import type { CollisionFootprintComponent } from '@tileborne/core';
import { Input, cn, typography } from '@tileborne/ui';

import {
  type FootprintOffset,
  footprintAllowsInstanceAdjust,
} from '@/lib/catalog-collision-footprint';

interface CollisionFootprintSectionProps {
  /** The selected object type's read-only collision footprint (decision `c-cgsd`). */
  readonly footprint: CollisionFootprintComponent;
  /** The placed object's current per-instance footprint offset. */
  readonly offset: FootprintOffset;
  readonly onOffsetChange: (offset: FootprintOffset) => void;
}

const parseOffsetValue = (raw: string): number | undefined => {
  if (raw.trim().length === 0) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

/**
 * Collision-footprint surface for a placed catalog object (ADR-0025 slice 6 /
 * decision `c-q83p`). The footprint geometry lives on the object-TYPE and is
 * shown read-only (part count, authoring source, `reviewed` flag). Where the
 * type permits — hand-authored `manual` footprints — the author tunes a
 * per-instance offset persisted on the placed `MapObject`; the type definition
 * is never mutated (decision `c-cgsd`). A live footprint preview is drawn in the
 * viewport under the "Collision" overlay toggle.
 */
export function CollisionFootprintSection({
  footprint,
  offset,
  onOffsetChange,
}: CollisionFootprintSectionProps) {
  const partCount = footprint.parts.length;
  const allowsAdjust = footprintAllowsInstanceAdjust(footprint);

  return (
    <section
      className="space-y-2"
      data-testid="collision-footprint-section"
      data-footprint-source={footprint.source}
      aria-label="Collision footprint"
    >
      <p className={cn('px-0.5', typography.sectionLabelMicro)}>Collision footprint</p>

      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1">
        <span className={cn('min-w-0 truncate', typography.rowTitle)}>
          {partCount} part{partCount === 1 ? '' : 's'} · {footprint.source}
        </span>
        <span
          className={cn('shrink-0 truncate', typography.rowMeta)}
          data-testid="footprint-reviewed"
          data-reviewed={footprint.reviewed ? 'true' : 'false'}
        >
          {footprint.reviewed ? 'reviewed' : 'unreviewed'}
        </span>
      </div>

      {allowsAdjust ? (
        <div className="space-y-1" data-testid="footprint-offset-adjust">
          <span className={cn('block', typography.rowMeta)}>Per-instance offset (px)</span>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 space-y-1">
              <span className={cn('block truncate', typography.rowMeta)}>Offset X</span>
              <Input
                type="number"
                step={1}
                value={String(offset.x)}
                data-testid="footprint-offset-x"
                onChange={(event) => {
                  const next = parseOffsetValue(event.target.value);
                  if (next !== undefined) {
                    onOffsetChange({ ...offset, x: next });
                  }
                }}
              />
            </label>
            <label className="min-w-0 space-y-1">
              <span className={cn('block truncate', typography.rowMeta)}>Offset Y</span>
              <Input
                type="number"
                step={1}
                value={String(offset.y)}
                data-testid="footprint-offset-y"
                onChange={(event) => {
                  const next = parseOffsetValue(event.target.value);
                  if (next !== undefined) {
                    onOffsetChange({ ...offset, y: next });
                  }
                }}
              />
            </label>
          </div>
        </div>
      ) : (
        <p className={cn('px-0.5', typography.bodyMicro)} data-testid="footprint-readonly-note">
          {footprint.source} footprints are read-only; re-derive at the source rather than adjusting
          a single instance.
        </p>
      )}
    </section>
  );
}
