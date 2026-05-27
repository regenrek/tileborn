import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
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
import { useCreateMap } from '@/hooks/mutations';
import { getIpcError } from '@/lib/ipc';
import {
  hasMapDimensionErrors,
  validateMapDimensions,
} from '@/lib/map-form-validation';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

interface CreateMapDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projectId: ProjectId | undefined;
}

export function CreateMapDialog({ open, onOpenChange, projectId }: CreateMapDialogProps) {
  const navigate = useNavigate();
  const createMap = useCreateMap();
  const [width, setWidth] = useState('64');
  const [height, setHeight] = useState('64');
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateMapDimensions>>({});
  const handleOpenChange = usePendingDialogClose(createMap.isPending, onOpenChange);

  const handleSubmit = async () => {
    if (!projectId) {
      notifyError('Open a project before creating a map.');
      return;
    }

    const errors = validateMapDimensions({ width, height });
    setFieldErrors(errors);
    if (hasMapDimensionErrors(errors)) {
      return;
    }

    try {
      const result = await createMap.mutateAsync({
        projectId,
        width: Number(width),
        height: Number(height),
      });
      notifySuccess(`Created map ${result.mapId}`);
      onOpenChange(false);
      await navigate({
        to: '/projects/$projectId/maps/$mapId',
        params: { projectId, mapId: result.mapId },
      });
    } catch (error) {
      const ipcError = getIpcError(error);
      notifyError(ipcError?.message ?? (error instanceof Error ? error.message : 'Map creation failed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form action={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create map</DialogTitle>
            <DialogDescription>
              Add an empty map with the width and height you need.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Width" htmlFor="create-map-width" message={fieldErrors.width}>
                <Input
                  id="create-map-width"
                  value={width}
                  onChange={(event) => setWidth(event.target.value)}
                  inputMode="numeric"
                  aria-invalid={fieldErrors.width !== undefined}
                />
              </FormField>
              <FormField label="Height" htmlFor="create-map-height" message={fieldErrors.height}>
                <Input
                  id="create-map-height"
                  value={height}
                  onChange={(event) => setHeight(event.target.value)}
                  inputMode="numeric"
                  aria-invalid={fieldErrors.height !== undefined}
                />
              </FormField>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <DialogSubmitButton
              type="submit"
              pending={createMap.isPending}
              disabled={!projectId}
              data-testid="create-map-submit"
            >
              Create map
            </DialogSubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
