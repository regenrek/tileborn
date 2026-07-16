import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@tileborne/ui';

import { AssetPackBrowser } from './asset-pack-browser';

interface AssetPackBrowserDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly packId: string;
  readonly packName: string;
  readonly projectId: string | null;
}

/**
 * Modal entry point for the asset library detail browser. Lets users curate
 * a working palette from within the asset library page or installed-pack
 * card without leaving the surrounding context.
 */
export function AssetPackBrowserDialog({
  open,
  onOpenChange,
  packId,
  packName,
  projectId,
}: AssetPackBrowserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] min-h-[60vh] flex-col gap-4 sm:max-w-5xl"
        data-testid="asset-pack-browser-dialog"
      >
        <DialogHeader>
          <DialogTitle>Browse asset pack</DialogTitle>
          <DialogDescription>
            Browse by tileset, terrain class, autotile rule, or object category, then add curated
            items to a working palette. Your sidebar will only show palette items.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <AssetPackBrowser
            packId={packId}
            packName={packName}
            projectId={projectId}
            variant="page"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
