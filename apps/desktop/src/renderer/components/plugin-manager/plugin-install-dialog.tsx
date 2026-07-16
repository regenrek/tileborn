import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Progress,
} from '@tileborne/ui';
import { FolderOpenIcon, PuzzleIcon } from 'lucide-react';

import { DialogSubmitButton, FormField, usePendingDialogClose } from '@/components/dialog-form';
import {
  useInstallBattleRoyalePlugin,
  useInstallPluginFromPath,
  usePickDirectory,
} from '@/hooks/mutations';
import { getIpcError } from '@/lib/ipc';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

interface PluginInstallDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function PluginInstallDialog({ open, onOpenChange }: PluginInstallDialogProps) {
  const installFromPath = useInstallPluginFromPath();
  const installBattleRoyale = useInstallBattleRoyalePlugin();
  const pickDirectory = usePickDirectory();
  const [pathValue, setPathValue] = useState('');
  const [pathError, setPathError] = useState<string | undefined>(undefined);

  const pending =
    installFromPath.isPending || installBattleRoyale.isPending || pickDirectory.isPending;
  const handleOpenChange = usePendingDialogClose(pending, onOpenChange);

  const resetOnClose = () => {
    if (!pending) {
      setPathValue('');
      setPathError(undefined);
    }
  };

  const installPath = async (path: string) => {
    const trimmed = path.trim();
    if (trimmed.length === 0) {
      setPathError('Enter a plugin directory path.');
      return;
    }
    setPathError(undefined);
    try {
      const result = await installFromPath.mutateAsync(trimmed);
      notifySuccess(`Installed plugin ${result.plugin.id}`);
      setPathValue('');
      onOpenChange(false);
    } catch (error) {
      const ipcError = getIpcError(error);
      notifyError(ipcError?.message ?? (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleBrowse = () => {
    void pickDirectory.mutateAsync().then((result) => {
      if (result.path === undefined) {
        return;
      }
      setPathValue(result.path);
      setPathError(undefined);
    });
  };

  const handleInstallBundled = async () => {
    try {
      const result = await installBattleRoyale.mutateAsync();
      notifySuccess(`Installed plugin ${result.plugin.id}`);
      onOpenChange(false);
    } catch (error) {
      const ipcError = getIpcError(error);
      notifyError(
        ipcError?.message ??
          (error instanceof Error ? error.message : 'Battle Royale install failed'),
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        handleOpenChange(nextOpen);
        if (!nextOpen) {
          resetOnClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install plugin</DialogTitle>
          <DialogDescription>
            Install from a local plugin folder or use the bundled Battle Royale plugin.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <PuzzleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium">Bundled Battle Royale</p>
                <p className="text-xs text-muted-foreground">
                  One-click install of the local Battle Royale gameplay plugin.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  data-testid="plugin-install-bundled-br"
                  onClick={() => void handleInstallBundled()}
                >
                  Install bundled BR
                </Button>
              </div>
            </div>
          </div>

          <FormField label="Plugin directory" htmlFor="plugin-install-path" message={pathError}>
            <Input
              id="plugin-install-path"
              value={pathValue}
              onChange={(event) => setPathValue(event.target.value)}
              placeholder="/path/to/tileborne-plugin"
              disabled={pending}
              aria-invalid={pathError !== undefined}
            />
          </FormField>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pending}
            onClick={handleBrowse}
          >
            <FolderOpenIcon />
            Browse folder…
          </Button>

          {pending ? (
            <div className="space-y-1">
              <Progress className="h-1" />
              <p className="text-xs text-muted-foreground">Installing plugin…</p>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Paste a folder containing <span className="font-mono">tileborne-plugin.json</span>.
          </p>
        </div>

        <DialogFooter>
          <DialogSubmitButton
            type="button"
            variant="outline"
            pending={false}
            disabled={pending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </DialogSubmitButton>
          <DialogSubmitButton
            type="button"
            data-testid="plugin-manager-install-from-path"
            pending={installFromPath.isPending}
            disabled={pending || pathValue.trim().length === 0}
            onClick={() => void installPath(pathValue)}
          >
            Install from folder
          </DialogSubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
