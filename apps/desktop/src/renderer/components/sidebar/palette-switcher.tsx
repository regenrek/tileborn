import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
  typography,
} from '@tileborne/ui';
import { CheckIcon, ChevronDownIcon, PaletteIcon, PlusIcon, Trash2Icon } from 'lucide-react';

import {
  useActiveWorkingPalette,
  useWorkingPaletteActions,
  useWorkingPalettes,
} from '@/hooks/use-working-palettes';
import { notifySuccess } from '@/stores/app-notifications-store';

interface PaletteSwitcherProps {
  readonly projectId: string | null | undefined;
  readonly packId: string;
  readonly packName: string;
  readonly variant?: 'sidebar' | 'inline';
  readonly testId?: string;
}

export function PaletteSwitcher({
  projectId,
  packName,
  variant = 'inline',
  testId = 'palette-switcher',
}: PaletteSwitcherProps) {
  const palettes = useWorkingPalettes({ projectId });
  const activePalette = useActiveWorkingPalette(projectId);
  const actions = useWorkingPaletteActions();

  const handleCreate = () => {
    void (async () => {
      const created = await actions.create({
        projectId,
        name: `${packName} palette ${palettes.length + 1}`,
      });
      await actions.setActive({ projectId, paletteId: created.id });
      notifySuccess(`Created "${created.name}"`);
    })();
  };

  const handleDelete = (paletteId: string, name: string) => {
    void actions.remove({ projectId, paletteId });
    notifySuccess(`Removed "${name}"`);
  };

  const label =
    activePalette !== undefined ? activePalette.name : 'No working palette';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size={variant === 'sidebar' ? 'sm' : 'sm'}
            data-testid={testId}
            className={cn(
              'min-w-0 justify-between gap-1.5',
              variant === 'sidebar' ? 'h-7 w-full px-2' : '',
            )}
          >
            <PaletteIcon aria-hidden className="size-3.5 shrink-0" />
            <span className={cn('min-w-0 truncate text-left', typography.bodyMicro)}>
              {label}
            </span>
            <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Working palettes</DropdownMenuLabel>
          {palettes.length === 0 ? (
            <DropdownMenuItem
              disabled
              data-testid="palette-switcher-empty"
              className={typography.bodyMicro}
            >
              No palettes yet for this project
            </DropdownMenuItem>
          ) : (
            palettes.map((palette) => {
              const isActive = activePalette?.id === palette.id;
              return (
                <DropdownMenuItem
                  key={palette.id}
                  data-testid={`palette-switcher-item-${palette.id}`}
                  onClick={() => {
                    void actions.setActive({ projectId, paletteId: palette.id });
                  }}
                  className="flex items-start gap-2"
                >
                  <span className="mt-0.5 size-4 shrink-0">
                    {isActive ? <CheckIcon className="size-4 text-primary" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn('truncate', typography.bodyCompact)}>{palette.name}</span>
                    <span className={typography.bodyMicro}>
                      {palette.items.length} item{palette.items.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove palette ${palette.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDelete(palette.id, palette.name);
                    }}
                    data-testid={`palette-switcher-delete-${palette.id}`}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            data-testid="palette-switcher-create"
            onClick={() => {
              handleCreate();
            }}
          >
            <PlusIcon className="size-4" />
            <span>New palette</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
