import {
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  type VisualAssetRoleRef,
} from '@tileborne/core';
import { cn, typography } from '@tileborne/ui';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface WeaponAttachmentPreviewProps {
  readonly roles: ReadonlyMap<string, VisualAssetRoleRef>;
}

const roleKey = (kind: string): string => kind;

const clampScale = (scale: number): number =>
  Number.isFinite(scale) ? Math.max(0.15, Math.min(2.5, scale)) : 1;

const rotatePoint = (point: Point, angleDeg: number): Point => {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
};

const add = (left: Point, right: Point): Point => ({
  x: left.x + right.x,
  y: left.y + right.y,
});

const direction = (angleDeg: number): Point => {
  const angle = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(angle), y: Math.sin(angle) };
};

export function WeaponAttachmentPreview({ roles }: WeaponAttachmentPreviewProps) {
  const weaponRole = roles.get(roleKey(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon));
  const projectileRole = roles.get(roleKey(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile));
  const muzzleRole = roles.get(roleKey(WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash));
  const weaponScale = clampScale(weaponRole?.renderProfile.scale ?? 1);
  const projectileScale = clampScale(projectileRole?.renderProfile.scale ?? 1);
  const muzzleScale = clampScale(muzzleRole?.renderProfile.scale ?? 1);
  const weaponWidth = 210 * weaponScale;
  const weaponHeight = 58 * weaponScale;
  const playerHand = { x: 360, y: 260 };
  const handAnchor = weaponRole?.anchors.hand;
  const muzzleAnchor = weaponRole?.anchors.muzzle;
  const handPoint = {
    x: (handAnchor?.point.x ?? weaponRole?.renderProfile.pivot.x ?? 0.28) * weaponWidth,
    y: (handAnchor?.point.y ?? weaponRole?.renderProfile.pivot.y ?? 0.56) * weaponHeight,
  };
  const muzzlePoint = {
    x: (muzzleAnchor?.point.x ?? 0.92) * weaponWidth,
    y: (muzzleAnchor?.point.y ?? 0.5) * weaponHeight,
  };
  const weaponAngle = handAnchor?.rotationDeg ?? 0;
  const shotAngle = weaponAngle + (muzzleAnchor?.rotationDeg ?? 0);
  const localMuzzle = { x: muzzlePoint.x - handPoint.x, y: muzzlePoint.y - handPoint.y };
  const muzzleWorld = add(playerHand, rotatePoint(localMuzzle, weaponAngle));
  const fireDirection = direction(shotAngle);
  const projectileStart = add(muzzleWorld, { x: fireDirection.x * 34, y: fireDirection.y * 34 });
  const projectileEnd = add(muzzleWorld, { x: fireDirection.x * 210, y: fireDirection.y * 210 });
  const muzzleRadius = 18 * muzzleScale;
  const projectileLength = 58 * projectileScale;
  const projectileThickness = 10 * projectileScale;

  return (
    <section
      className="overflow-hidden rounded-md border border-border bg-card"
      data-testid="weapon-attachment-preview"
    >
      <div className="border-b border-border px-3 py-2">
        <h2 className={typography.panelTitle}>Attachment Preview</h2>
        <p className={typography.rowMeta}>
          {weaponRole === undefined
            ? 'Assign an equipped weapon role to preview hand and muzzle alignment.'
            : `${weaponRole.label} · ${weaponAngle.toFixed(0)}deg`}
        </p>
      </div>
      <svg
        viewBox="0 0 760 420"
        className="h-[22rem] w-full bg-background"
        role="img"
        aria-label="Weapon attachment preview"
        data-angle={shotAngle.toFixed(2)}
        data-weapon-angle={weaponAngle.toFixed(2)}
        data-muzzle-x={muzzleWorld.x.toFixed(2)}
        data-muzzle-y={muzzleWorld.y.toFixed(2)}
      >
        <defs>
          <marker id="weapon-preview-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#38bdf8" />
          </marker>
        </defs>
        <rect x="0" y="0" width="760" height="420" fill="rgba(12,16,24,.95)" />
        <g opacity="0.22">
          {Array.from({ length: 16 }, (_, index) => (
            <line key={`v-${index}`} x1={index * 50} y1="0" x2={index * 50} y2="420" stroke="white" strokeWidth="1" />
          ))}
          {Array.from({ length: 9 }, (_, index) => (
            <line key={`h-${index}`} x1="0" y1={index * 50} x2="760" y2={index * 50} stroke="white" strokeWidth="1" />
          ))}
        </g>

        <g data-testid="weapon-preview-player">
          <ellipse cx="300" cy="266" rx="74" ry="92" fill="#1e3a5f" opacity="0.72" />
          <circle cx="300" cy="198" r="44" fill="#e2e8f0" />
          <circle cx={playerHand.x} cy={playerHand.y} r="9" fill="#f97316" />
          <text x="236" y="370" fill="#94a3b8" fontSize="14">
            player hand anchor
          </text>
        </g>

        {weaponRole === undefined ? null : (
          <g
            data-testid="weapon-preview-weapon"
            transform={`translate(${playerHand.x} ${playerHand.y}) rotate(${weaponAngle}) translate(${-handPoint.x} ${-handPoint.y})`}
          >
            <rect
              x="0"
              y="0"
              width={weaponWidth}
              height={weaponHeight}
              rx="8"
              fill="#5eead4"
              opacity="0.84"
              stroke="#0f172a"
              strokeWidth="5"
            />
            <rect
              x={weaponWidth * 0.08}
              y={weaponHeight * 0.35}
              width={weaponWidth * 0.86}
              height={weaponHeight * 0.3}
              rx="3"
              fill="#0f172a"
              opacity="0.65"
            />
            <circle cx={handPoint.x} cy={handPoint.y} r="8" fill="#f97316" data-testid="weapon-preview-hand" />
            <circle cx={muzzlePoint.x} cy={muzzlePoint.y} r="8" fill="#ef4444" data-testid="weapon-preview-muzzle-local" />
          </g>
        )}

        {weaponRole === undefined ? null : (
          <g data-testid="weapon-preview-shot">
            <line
              x1={muzzleWorld.x}
              y1={muzzleWorld.y}
              x2={projectileEnd.x}
              y2={projectileEnd.y}
              stroke="#38bdf8"
              strokeWidth="4"
              strokeDasharray="8 8"
              markerEnd="url(#weapon-preview-arrow)"
            />
            <circle
              cx={muzzleWorld.x}
              cy={muzzleWorld.y}
              r={muzzleRadius}
              fill="#f97316"
              opacity="0.74"
              data-testid="weapon-preview-muzzle-flash"
            />
            <rect
              x={projectileStart.x}
              y={projectileStart.y - projectileThickness / 2}
              width={projectileLength}
              height={projectileThickness}
              rx={projectileThickness / 2}
              fill="#facc15"
              transform={`rotate(${shotAngle} ${projectileStart.x} ${projectileStart.y})`}
              data-testid="weapon-preview-projectile"
            />
          </g>
        )}
      </svg>
      <div className="grid gap-2 border-t border-border p-3 md:grid-cols-3">
        <PreviewMetric label="Weapon" value={weaponRole?.label ?? 'Unassigned'} />
        <PreviewMetric label="Muzzle flash" value={muzzleRole?.label ?? 'Unassigned'} />
        <PreviewMetric label="Projectile" value={projectileRole?.label ?? 'Unassigned'} />
      </div>
    </section>
  );
}

function PreviewMetric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background px-2 py-1.5">
      <p className={cn('truncate', typography.rowMeta)}>{label}</p>
      <p className={cn('truncate', typography.rowTitle)}>{value}</p>
    </div>
  );
}
