import { cn, typography } from '@tileborne/ui';
import { MapIcon } from 'lucide-react';

const GRADIENT_VARIANTS = [
  'from-primary/45 via-accent/25 to-muted',
  'from-accent/40 via-info/20 to-muted',
  'from-info/35 via-primary/30 to-muted',
  'from-warning/25 via-accent/35 to-muted',
] as const;

function gradientVariant(projectId: string): (typeof GRADIENT_VARIANTS)[number] {
  let hash = 0;
  for (let index = 0; index < projectId.length; index += 1) {
    hash = (hash * 31 + projectId.charCodeAt(index)) >>> 0;
  }
  return GRADIENT_VARIANTS[hash % GRADIENT_VARIANTS.length]!;
}

interface ProjectMapPreviewThumbProps {
  readonly projectId: string;
  readonly mapId?: string | undefined;
  readonly className?: string | undefined;
}

export function ProjectMapPreviewThumb({
  projectId,
  mapId,
  className,
}: ProjectMapPreviewThumbProps) {
  return (
    <div
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-md border border-border/60 bg-muted',
        className,
      )}
      aria-hidden
    >
      <div className={cn('absolute inset-0 bg-gradient-to-br', gradientVariant(projectId))} />
      <div className="absolute inset-0 flex items-center justify-center opacity-40">
        <MapIcon className="size-8 text-foreground/70" />
      </div>
      {mapId ? (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/80 to-transparent px-2 py-1.5">
          <p className={cn(typography.bodyMicro, 'truncate text-foreground')}>{mapId}</p>
        </div>
      ) : null}
    </div>
  );
}
