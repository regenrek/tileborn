import { useMemo, useState } from 'react';
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

import {
  DialogSubmitButton,
  FormField,
  usePendingDialogClose,
} from '@/components/dialog-form';
import { useCreateProject } from '@/hooks/mutations';
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
  const createProject = useCreateProject();
  const addRecentProject = useEditorUiStore((s) => s.addRecentProject);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const handleOpenChange = usePendingDialogClose(createProject.isPending, onOpenChange);

  const slugPreview = useMemo(() => deriveProjectSlug(name), [name]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError('Project name is required.');
      return;
    }
    setNameError(undefined);

    try {
      const result = await createProject.mutateAsync({ name: trimmed });
      addRecentProject(String(result.projectId));
      notifySuccess(`Created project ${trimmed}`);
      setName('');
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
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Name your project. The slug is derived automatically for folders on disk.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
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
              pending={createProject.isPending}
              data-testid="create-project-submit"
            >
              Create project
            </DialogSubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
