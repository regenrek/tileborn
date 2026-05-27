import { Button, cn, typography } from '@tileborne/ui';
import { FolderOpenIcon, ImportIcon, LayoutGridIcon, PlusIcon } from 'lucide-react';

interface HomeEmptyStateProps {
  readonly createPending: boolean;
  readonly importPending: boolean;
  readonly onCreate: () => void;
  readonly onImport: () => void;
}

export function HomeEmptyState({
  createPending,
  importPending,
  onCreate,
  onImport,
}: HomeEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 via-accent/20 to-muted">
        <LayoutGridIcon className="size-8 text-primary" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className={cn(typography.caption, 'font-medium text-foreground')}>
          No projects yet
        </p>
        <p className={typography.bodyCompact}>
          Create a project to author maps, import asset packs, and install plugins.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="lg" disabled={createPending} onClick={onCreate}>
          <PlusIcon />
          Create project
        </Button>
        <Button variant="outline" size="lg" disabled={importPending} onClick={onImport}>
          <ImportIcon />
          Import project
        </Button>
      </div>
      <p className={cn(typography.bodyMicro, 'inline-flex items-center gap-1')}>
        <FolderOpenIcon className="size-3.5" aria-hidden />
        Or import an existing Tileborne project folder
      </p>
    </div>
  );
}
