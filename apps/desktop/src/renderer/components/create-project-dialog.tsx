import { useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@tileborne/ui';

import { DialogSubmitButton, FormField, usePendingDialogClose } from '@/components/dialog-form';
import { useCreateGame } from '@/hooks/mutations';
import { deriveProjectSlug } from '@/lib/derive-project-slug';
import { getIpcError } from '@/lib/ipc';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface CreateProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({ open, onOpenChange }: CreateProjectDialogProps) {
  const navigate = useNavigate();
  const createGame = useCreateGame();
  const addRecentProject = useEditorUiStore((s) => s.addRecentProject);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const idempotencyKey = useRef<string | undefined>(undefined);
  const currentIdempotencyKey = idempotencyKey.current ?? crypto.randomUUID();
  idempotencyKey.current = currentIdempotencyKey;
  const handleOpenChange = usePendingDialogClose(createGame.isPending, onOpenChange);

  const slugPreview = useMemo(() => deriveProjectSlug(name), [name]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError('Project name is required.');
      return;
    }
    setNameError(undefined);

    try {
      const result = await createGame.mutateAsync({
        name: trimmed,
        gameType: 'battle-royale',
        idempotencyKey: currentIdempotencyKey,
      });
      addRecentProject(String(result.projectId));
      notifySuccess(`${result.resumed ? 'Resumed' : 'Created'} Battle Royale game ${trimmed}`);
      setName('');
      idempotencyKey.current = crypto.randomUUID();
      onOpenChange(false);
      await navigate({
        to: '/projects/$projectId',
        params: { projectId: result.projectId },
      });
    } catch (error) {
      const ipcError = getIpcError(error);
      notifyError(
        ipcError?.message ?? (error instanceof Error ? error.message : 'Project creation failed'),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form action={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New game</DialogTitle>
            <DialogDescription>
              Choose a game type and start with valid, editable content.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <fieldset className="grid gap-2" role="radiogroup" aria-label="Game type">
              <legend className="text-sm font-medium">Game type</legend>
              <button
                type="button"
                role="radio"
                aria-checked="true"
                className="rounded-md border border-primary bg-primary/10 p-3 text-left"
                data-testid="new-game-type-battle-royale"
              >
                <span className="block text-sm font-medium">Battle Royale</span>
                <span className="block text-xs text-muted-foreground">
                  Starter arena, Maltipoo players, HUD, controls, loot and weapons.
                </span>
              </button>
            </fieldset>
            <FormField label="Project name" htmlFor="create-project-name" message={nameError}>
              <Input
                id="create-project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My game"
                aria-invalid={nameError !== undefined}
              />
            </FormField>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">Slug preview</p>
              <p className="font-mono text-sm">{slugPreview}</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <DialogSubmitButton
              type="submit"
              pending={createGame.isPending}
              data-testid="create-project-submit"
            >
              Create Battle Royale game
            </DialogSubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
