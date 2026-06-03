import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
  typography,
} from '@tileborne/ui';
import { DownloadIcon, UploadIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { useExportCatalog, useImportCatalog } from '@/hooks/mutations';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

interface CatalogImportExportProps {
  readonly projectId: string | null | undefined;
}

interface PendingImport {
  readonly fileName: string;
  readonly catalogJson: unknown;
}

const EXPORT_FILE_NAME = 'catalog-fragment.json';

/** Trigger a renderer-side file download for the serialized catalog pack. */
const downloadJson = (value: unknown, fileName: string): void => {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * Catalog fragment import/export controls (ADR-0025 slice 7). The main handlers
 * already exist (slice 3); this is the renderer UX:
 *
 * - **Export** serializes the project-authored fragment via
 *   `tileborne:catalog:export` and saves it as a JSON file.
 * - **Import** picks a `GameObjectCatalog` JSON fragment, then surfaces the
 *   `requiresApproval` confirmation before calling `tileborne:catalog:import`.
 *   The main service decodes + validates and persists only when valid; on
 *   success the `catalog:resolve` query is invalidated (in `useImportCatalog`)
 *   so the catalog-driven palette/inspector refresh. On a validation failure
 *   nothing is persisted and the returned report's issues are shown inline (the
 *   navigable diagnostics drawer is slice 8).
 *
 * Stays plugin-neutral: it consumes only the `catalog:*` IPC DTOs (via the
 * mutation hooks) plus browser file/JSON APIs — never `services-plugin` or the
 * merge helper.
 */
export function CatalogImportExport({ projectId }: CatalogImportExportProps) {
  const exportCatalog = useExportCatalog();
  const importCatalog = useImportCatalog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  const hasProject = projectId !== null && projectId !== undefined && projectId.length > 0;
  const report = importCatalog.data?.imported === false ? importCatalog.data.report : undefined;

  const handleExport = async () => {
    if (!hasProject) {
      return;
    }
    try {
      const { catalogJson } = await exportCatalog.mutateAsync({ projectId: projectId! });
      downloadJson(catalogJson, EXPORT_FILE_NAME);
      notifySuccess('Exported catalog fragment');
    } catch {
      notifyError('Could not export the catalog fragment');
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-selecting the same file still fires `change`.
    event.target.value = '';
    if (file === undefined) {
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => notifyError('Could not read the selected file');
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        notifyError('Selected file is not valid JSON');
        return;
      }
      importCatalog.reset();
      setPendingImport({ fileName: file.name, catalogJson: parsed });
    };
    reader.readAsText(file);
  };

  const closeDialog = () => {
    setPendingImport(null);
    importCatalog.reset();
  };

  const handleConfirmImport = async () => {
    if (pendingImport === null || !hasProject) {
      return;
    }
    try {
      const result = await importCatalog.mutateAsync({
        projectId: projectId!,
        catalogJson: pendingImport.catalogJson,
      });
      if (result.imported) {
        notifySuccess('Imported catalog fragment');
        closeDialog();
      }
      // Otherwise keep the dialog open and render the validation report below.
    } catch {
      notifyError('Could not import the catalog fragment');
    }
  };

  return (
    <div
      className="flex flex-col gap-1.5 px-1"
      data-testid="catalog-import-export"
    >
      <p className={cn('px-1', typography.sectionLabelMicro)}>Catalog</p>
      <div className="flex items-center gap-1 px-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 flex-1 px-2"
          data-testid="catalog-export-button"
          disabled={!hasProject || exportCatalog.isPending}
          onClick={() => void handleExport()}
        >
          <DownloadIcon className="size-3" aria-hidden />
          Export
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 flex-1 px-2"
          data-testid="catalog-import-button"
          disabled={!hasProject}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon className="size-3" aria-hidden />
          Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="catalog-import-file-input"
          onChange={handleFileChange}
        />
      </div>

      <Dialog
        open={pendingImport !== null}
        onOpenChange={(next) => {
          if (!next && !importCatalog.isPending) {
            closeDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="catalog-import-dialog">
          <DialogHeader>
            <DialogTitle>Import catalog fragment?</DialogTitle>
            <DialogDescription>
              Importing <code>{pendingImport?.fileName}</code> validates the pack and replaces this
              project&apos;s authored catalog fragment. Plugin-shipped catalogs are not changed.
            </DialogDescription>
          </DialogHeader>

          {report !== undefined ? (
            <div
              className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/5 p-2"
              data-testid="catalog-import-report"
            >
              <p className={cn(typography.bodyMicro, 'text-destructive')}>
                Import blocked — {report.issues.length} validation issue
                {report.issues.length === 1 ? '' : 's'} (nothing was saved):
              </p>
              <ul className="flex flex-col gap-1">
                {report.issues.map((issue, index) => (
                  <li
                    key={`${issue.kind}-${issue.objectTypeId ?? issue.missingId ?? index}`}
                    className={cn(typography.bodyMicro)}
                    data-testid="catalog-import-issue"
                  >
                    <span className="font-mono text-muted-foreground">[{issue.kind}]</span>{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={closeDialog}
              disabled={importCatalog.isPending}
              data-testid="catalog-import-cancel"
            >
              {report !== undefined ? 'Close' : 'Cancel'}
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirmImport()}
              disabled={importCatalog.isPending}
              data-testid="catalog-import-confirm"
            >
              {report !== undefined ? 'Re-import' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
