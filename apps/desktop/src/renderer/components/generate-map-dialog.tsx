import { useMemo, useReducer } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { PackId, ProjectId } from '@tileborne/core';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tileborne/ui';

import { DialogSubmitButton, FormField, usePendingDialogClose } from '@/components/dialog-form';
import {
  GenerateMapPresetPreview,
  type GeneratePreset,
} from '@/components/generate-map-preset-preview';
import { useGenerateMap } from '@/hooks/mutations';
import { useAssetPacks } from '@/hooks/queries';
import { getIpcError } from '@/lib/ipc';
import { hasMapDimensionErrors, validateMapDimensions } from '@/lib/map-form-validation';
import { usePackCapabilities } from '@/lib/pack-capability-client';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

interface GenerateMapDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projectId?: string | undefined;
}

type GenerateMapFieldErrors = ReturnType<typeof validateMapDimensions>;

interface GenerateMapFormState {
  readonly width: string;
  readonly height: string;
  readonly seed: string;
  readonly preset: GeneratePreset;
  readonly tilesetPackId: string;
  readonly fieldErrors: GenerateMapFieldErrors;
  readonly tilesetError: string | undefined;
}

type GenerateMapFormAction =
  | { readonly type: 'set-width'; readonly value: string }
  | { readonly type: 'set-height'; readonly value: string }
  | { readonly type: 'set-seed'; readonly value: string }
  | { readonly type: 'set-preset'; readonly value: GeneratePreset }
  | { readonly type: 'set-tileset-pack'; readonly value: string }
  | { readonly type: 'set-field-errors'; readonly errors: GenerateMapFieldErrors }
  | { readonly type: 'set-tileset-error'; readonly error: string | undefined };

function createGenerateMapFormState(): GenerateMapFormState {
  return {
    width: '64',
    height: '64',
    seed: String(Math.floor(Math.random() * 1_000_000)),
    preset: 'dungeon',
    tilesetPackId: '',
    fieldErrors: {},
    tilesetError: undefined,
  };
}

function generateMapFormReducer(
  state: GenerateMapFormState,
  action: GenerateMapFormAction,
): GenerateMapFormState {
  switch (action.type) {
    case 'set-width':
      return { ...state, width: action.value };
    case 'set-height':
      return { ...state, height: action.value };
    case 'set-seed':
      return { ...state, seed: action.value };
    case 'set-preset':
      return { ...state, preset: action.value };
    case 'set-tileset-pack':
      return {
        ...state,
        tilesetPackId: action.value,
        tilesetError: undefined,
      };
    case 'set-field-errors':
      return { ...state, fieldErrors: action.errors };
    case 'set-tileset-error':
      return { ...state, tilesetError: action.error };
  }
}

export function GenerateMapDialog({ open, onOpenChange, projectId }: GenerateMapDialogProps) {
  const navigate = useNavigate();
  const generateMap = useGenerateMap();
  const assetPacksQuery = useAssetPacks();
  const refetchAssetPacks = assetPacksQuery.refetch;
  const [form, dispatchForm] = useReducer(
    generateMapFormReducer,
    undefined,
    createGenerateMapFormState,
  );

  const allPacks = assetPacksQuery.data?.packs ?? [];
  const { byId: capabilityById, isLoading: capabilitiesLoading } = usePackCapabilities();
  const paintablePacks = useMemo(
    () => allPacks.filter((pack) => capabilityById.get(pack.id)?.paintable === true),
    [allPacks, capabilityById],
  );
  const defaultPackId = paintablePacks[0]?.id ?? '';
  const resolvedTilesetPackId = form.tilesetPackId.length > 0 ? form.tilesetPackId : defaultPackId;
  const handleOpenChange = usePendingDialogClose(generateMap.isPending, onOpenChange);

  const presetValues = useMemo(
    () => ['open', 'dungeon', 'arena'] as const satisfies readonly GeneratePreset[],
    [],
  );
  const handleGenerateDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      void refetchAssetPacks();
    }
    handleOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    if (!projectId) {
      notifyError('Open a project before generating a map.');
      return;
    }

    const errors = validateMapDimensions({
      width: form.width,
      height: form.height,
      seed: form.seed,
    });
    dispatchForm({ type: 'set-field-errors', errors });
    if (hasMapDimensionErrors(errors)) {
      return;
    }
    if (resolvedTilesetPackId.length === 0) {
      dispatchForm({
        type: 'set-tileset-error',
        error: 'Import a tileset pack before generating a map.',
      });
      return;
    }
    dispatchForm({ type: 'set-tileset-error', error: undefined });

    try {
      const result = await generateMap.mutateAsync({
        projectId: projectId as ProjectId,
        width: Number(form.width),
        height: Number(form.height),
        seed: Number(form.seed),
        preset: form.preset,
        tilesetPackId: resolvedTilesetPackId as PackId,
      });
      onOpenChange(false);
      notifySuccess(`Generated map ${result.map.id}`);
      await navigate({
        to: '/projects/$projectId/maps/$mapId',
        params: { projectId, mapId: result.map.id },
      });
    } catch (error) {
      const ipcError = getIpcError(error);
      notifyError(
        ipcError?.message ?? (error instanceof Error ? error.message : 'Map generation failed'),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleGenerateDialogOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form action={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Generate map</DialogTitle>
            <DialogDescription>
              Create a procedural map using the selected tileset and generator preset.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <FormField label="Tileset" htmlFor="generate-tileset" message={form.tilesetError}>
              <Select
                value={resolvedTilesetPackId}
                onValueChange={(value) => {
                  dispatchForm({ type: 'set-tileset-pack', value: value ?? '' });
                }}
              >
                <SelectTrigger id="generate-tileset" aria-invalid={form.tilesetError !== undefined}>
                  <SelectValue placeholder="Select installed pack" />
                </SelectTrigger>
                <SelectContent>
                  {paintablePacks.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      {capabilitiesLoading
                        ? 'Inspecting installed packs…'
                        : allPacks.length === 0
                          ? 'Import a tileset pack first'
                          : 'No paintable packs — import a Tileborne pack with tilesets'}
                    </SelectItem>
                  ) : (
                    paintablePacks.map((pack) => {
                      const cap = capabilityById.get(pack.id);
                      return (
                        <SelectItem key={pack.id} value={pack.id}>
                          {pack.name}
                          {cap !== undefined ? ` · ${cap.tilesetCount} tilesets` : ''}
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Width" htmlFor="generate-width" message={form.fieldErrors.width}>
                <Input
                  id="generate-width"
                  value={form.width}
                  onChange={(event) =>
                    dispatchForm({ type: 'set-width', value: event.target.value })
                  }
                  inputMode="numeric"
                  aria-invalid={form.fieldErrors.width !== undefined}
                />
              </FormField>
              <FormField label="Height" htmlFor="generate-height" message={form.fieldErrors.height}>
                <Input
                  id="generate-height"
                  value={form.height}
                  onChange={(event) =>
                    dispatchForm({ type: 'set-height', value: event.target.value })
                  }
                  inputMode="numeric"
                  aria-invalid={form.fieldErrors.height !== undefined}
                />
              </FormField>
            </div>

            <FormField label="Seed" htmlFor="generate-seed" message={form.fieldErrors.seed}>
              <Input
                id="generate-seed"
                value={form.seed}
                onChange={(event) => dispatchForm({ type: 'set-seed', value: event.target.value })}
                inputMode="numeric"
                aria-invalid={form.fieldErrors.seed !== undefined}
              />
            </FormField>

            <div className="grid gap-2">
              <p className="text-xs font-medium">Preset</p>
              <div className="grid grid-cols-3 gap-2">
                {presetValues.map((value) => (
                  <GenerateMapPresetPreview
                    key={value}
                    preset={value}
                    selected={form.preset === value}
                    onSelect={() => dispatchForm({ type: 'set-preset', value })}
                  />
                ))}
              </div>
            </div>

            {generateMap.isPending ? (
              <div className="space-y-1">
                <Progress className="h-1" />
                <p className="text-xs text-muted-foreground">Generating map…</p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <DialogSubmitButton
              type="submit"
              data-testid="generate-map-submit"
              pending={generateMap.isPending}
              disabled={!projectId || resolvedTilesetPackId.length === 0}
            >
              Generate
            </DialogSubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
