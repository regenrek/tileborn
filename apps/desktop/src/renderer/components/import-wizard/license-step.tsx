import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  cn,
} from '@tileborne/ui';
import { ChevronsUpDownIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { TiledImportLicenseDraft } from './types';

const commonSpdxIds = [
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC0-1.0',
  'Unlicense',
] as const;

export const licenseRequiresAttribution = (spdxId: string | undefined): boolean => {
  const normalized = spdxId?.trim();
  if (normalized === undefined || normalized.length === 0) return false;
  return normalized !== 'CC0-1.0' && normalized !== 'Unlicense';
};

function SpdxCombobox({
  value,
  onValueChange,
}: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim();
  const options = useMemo(() => {
    const entries = new Set<string>(commonSpdxIds);
    if (value.trim().length > 0) entries.add(value.trim());
    if (trimmedQuery.length > 0) entries.add(trimmedQuery);
    return [...entries];
  }, [trimmedQuery, value]);
  const select = (next: string) => {
    onValueChange(next === 'custom' ? trimmedQuery : next);
    setQuery('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            data-testid="spdx-combobox"
          >
            {value.trim().length > 0 ? value : 'Select SPDX id'}
            <ChevronsUpDownIcon data-icon="inline-end" />
          </Button>
        }
      />
      <PopoverContent className="p-0" align="start">
        <Command>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search or enter a custom SPDX id"
          />
          <CommandList>
            <CommandEmpty>No SPDX ids found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  data-checked={option === value ? 'true' : 'false'}
                  onSelect={() => select(option)}
                >
                  {option}
                  {commonSpdxIds.includes(option as (typeof commonSpdxIds)[number]) ? null : (
                    <Badge variant="outline" className="ml-auto">
                      custom
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function LicenseStep({
  license,
  onLicenseChange,
}: {
  readonly license: TiledImportLicenseDraft;
  readonly onLicenseChange: (license: TiledImportLicenseDraft) => void;
}) {
  const attributionRequired = licenseRequiresAttribution(license.id);
  const attributionMissing = attributionRequired && (license.attribution?.trim().length ?? 0) === 0;

  return (
    <FieldSet>
      <FieldLegend>License and provenance</FieldLegend>
      <FieldGroup>
        <Field data-invalid={attributionMissing ? true : undefined}>
          <FieldLabel htmlFor="tiled-license-id">SPDX id</FieldLabel>
          <SpdxCombobox
            value={license.id ?? ''}
            onValueChange={(id) => onLicenseChange({ ...license, id })}
          />
          <FieldDescription>Leave blank when the source license is unknown.</FieldDescription>
        </Field>
        <Field data-invalid={attributionMissing ? true : undefined}>
          <FieldLabel htmlFor="tiled-license-attribution">Attribution</FieldLabel>
          <Input
            id="tiled-license-attribution"
            value={license.attribution ?? ''}
            aria-invalid={attributionMissing}
            onChange={(event) =>
              onLicenseChange({ ...license, attribution: event.currentTarget.value })
            }
          />
        </Field>
        <Field>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3">
            <span className="grid gap-1">
              <span className="text-sm font-medium">Redistributable</span>
              <span className="text-xs text-muted-foreground">
                Off by default. Non-redistributable imports are blocked from bundle operations.
              </span>
            </span>
            <Switch
              checked={license.redistributable}
              onCheckedChange={(checked) =>
                onLicenseChange({ ...license, redistributable: checked })
              }
            />
          </label>
        </Field>
        {attributionMissing ? (
          <Alert>
            <AlertTitle>Attribution required</AlertTitle>
            <AlertDescription>
              <span className={cn('block')}>
                {license.id} requires attribution before the import can be confirmed.
              </span>
            </AlertDescription>
          </Alert>
        ) : null}
      </FieldGroup>
    </FieldSet>
  );
}
