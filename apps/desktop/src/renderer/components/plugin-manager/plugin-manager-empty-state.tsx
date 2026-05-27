import { Button, cn, typography } from '@tileborne/ui';
import { FolderOpenIcon, PuzzleIcon } from 'lucide-react';

interface PluginManagerEmptyStateProps {
  readonly installPending: boolean;
  readonly onInstallBundled: () => void;
  readonly onInstallFromPath: () => void;
}

export function PluginManagerEmptyState({
  installPending,
  onInstallBundled,
  onInstallFromPath,
}: PluginManagerEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
        <PuzzleIcon className="size-6 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className={cn(typography.caption, 'font-medium text-foreground')}>
          No plugins installed
        </p>
        <p className={typography.bodyCompact}>
          Install your first plugin to extend playtest, editor commands, and runtime systems.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          data-testid="plugin-manager-install-first-bundled"
          disabled={installPending}
          onClick={onInstallBundled}
        >
          Install Battle Royale
        </Button>
        <Button variant="outline" disabled={installPending} onClick={onInstallFromPath}>
          <FolderOpenIcon />
          Install from path…
        </Button>
      </div>
    </div>
  );
}
