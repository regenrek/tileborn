import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  motion,
  typography,
} from '@tileborne/ui';

import type { AssetPacksListResponse } from '@/lib/bridge-types';

import { AssetPackPreviewThumb } from './asset-pack-preview-thumb';

type AssetPackSummary = AssetPacksListResponse['packs'][number];

interface AssetPackCardProps {
  readonly pack: AssetPackSummary;
  readonly selected: boolean;
  readonly isActivePalette: boolean;
  readonly onSelect: () => void;
}

export function AssetPackCard({
  pack,
  selected,
  isActivePalette,
  onSelect,
}: AssetPackCardProps) {
  return (
    <Card
      data-testid={`asset-pack-card-${pack.id}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'cursor-pointer gap-2 py-2',
        motion.fast,
        'hover:border-primary/40 hover:bg-muted/20',
        selected && 'border-primary ring-1 ring-primary/30',
      )}
    >
      <CardHeader className="gap-2 px-2">
        <AssetPackPreviewThumb packId={pack.id} />
        <div className="flex min-w-0 items-start justify-between gap-2">
          <CardTitle className={cn('truncate text-sm', typography.caption)}>{pack.name}</CardTitle>
          {isActivePalette ? (
            <Badge variant="secondary" className={typography.micro}>
              Active
            </Badge>
          ) : null}
        </div>
        <CardDescription className={typography.bodyMicro}>
          v{pack.version} · {pack.assetCount} assets
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pb-1">
        <p className={cn('truncate', typography.bodyMicro)}>{pack.licenseSpdxId}</p>
      </CardContent>
    </Card>
  );
}
