import { ImportWizard } from '@/components/import-wizard/tiled-import-wizard';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface AssetImportDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projectId?: string | undefined;
}

export function AssetImportDialog({ open, onOpenChange, projectId }: AssetImportDialogProps) {
  const sourcePath = useEditorUiStore((state) => state.assetImportSourcePath);
  const setSourcePath = useEditorUiStore((state) => state.setAssetImportSourcePath);
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSourcePath(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <ImportWizard
      open={open}
      onOpenChange={handleOpenChange}
      projectId={projectId}
      initialSourcePath={sourcePath}
    />
  );
}
