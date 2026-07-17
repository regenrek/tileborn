import { Button, cn, typography } from '@tileborne/ui';
import { ImportIcon, PackageOpenIcon } from 'lucide-react';

interface AssetLibraryEmptyStateProps {
  readonly importPending: boolean;
  readonly onImportDirectory: () => void;
  readonly isDragActive?: boolean;
}

export function AssetLibraryEmptyState({
  importPending,
  onImportDirectory,
  isDragActive = false,
}: AssetLibraryEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-16 text-center',
        isDragActive ? 'border-primary bg-primary/5' : 'border-border bg-card/50',
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
        <PackageOpenIcon className="size-6 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className={cn(typography.caption, 'font-medium text-foreground')}>
          No asset packs installed
        </p>
        <p className={typography.bodyCompact}>
          Import a tileset pack to paint tiles and browse thumbnails in the editor.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          data-testid="asset-library-import-pack"
          disabled={importPending}
          onClick={onImportDirectory}
        >
          <ImportIcon data-icon="inline-start" />
          Import
        </Button>
      </div>
      <p className={typography.bodyMicro}>or drop a pack folder anywhere on this page</p>
    </div>
  );
}
