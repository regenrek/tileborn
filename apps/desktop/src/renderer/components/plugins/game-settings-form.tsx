import { useEffect, useState } from 'react';
import { Button, Input, cn, typography } from '@tileborne/ui';
import { SaveIcon } from 'lucide-react';
import {
  gameSettingsToDraft,
  parseGameSettingsDraft,
  type MaterializedGameSettingsForm,
} from '@tileborne/plugin-api';
import type { JsonObject } from '@tileborne/core';

interface GameSettingsFormProps {
  /** The decoded + materialized settings form (manifest-discovered). */
  readonly form: MaterializedGameSettingsForm;
  /** Current FLAT settings values keyed by field key (defaults fill gaps). */
  readonly values: JsonObject;
  readonly disabled?: boolean;
  readonly saveLabel?: string;
  /** Prefix for per-field + save button `data-testid`s. */
  readonly testIdPrefix?: string;
  /** Persist the parsed + validated flat values. */
  readonly onSave: (values: Record<string, number>) => void | Promise<void>;
  /** Notified with {@link MaterializedGameSettingsForm.invalidMessage} on a blocked save. */
  readonly onInvalid?: (message: string) => void;
}

/**
 * Generic, manifest-driven game-mode settings form (ADR-0023 section A). Renders
 * + validates a settings form purely from a decoded `EditorGameSettingsForm`
 * declaration — it never names a plugin-specific field. The caller owns reading
 * the current FLAT values and persisting the parsed result (so a mode can
 * translate to its own durable shape, e.g. Battle Royale's nested zone config,
 * while a plain mode round-trips flat values under `map.properties.<pluginId>`).
 */
export function GameSettingsForm({
  form,
  values,
  disabled = false,
  saveLabel = 'Save settings',
  testIdPrefix = 'game-setting',
  onSave,
  onInvalid,
}: GameSettingsFormProps) {
  const [draft, setDraft] = useState(() => gameSettingsToDraft(form, values));

  useEffect(() => {
    setDraft(gameSettingsToDraft(form, values));
  }, [form, values]);

  const parsed = parseGameSettingsDraft(form, draft);

  const save = async () => {
    if (parsed === undefined) {
      onInvalid?.(form.invalidMessage);
      return;
    }
    await onSave(parsed);
  };

  return (
    <div className="space-y-3" data-testid={`${testIdPrefix}-form`}>
      <div className="grid grid-cols-2 gap-2">
        {form.fields.map((field) => (
          <label key={field.key} className="min-w-0 space-y-1">
            <span className={cn('block truncate', typography.rowMeta)}>{field.label}</span>
            <Input
              type="number"
              {...(field.min !== undefined ? { min: field.min } : {})}
              {...(field.max !== undefined ? { max: field.max } : {})}
              {...(field.step !== undefined ? { step: field.step } : {})}
              value={draft[field.key] ?? ''}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [field.key]: event.target.value }))
              }
              data-testid={`${testIdPrefix}-${field.key}`}
            />
          </label>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={disabled || parsed === undefined}
        onClick={() => void save()}
        data-testid={`${testIdPrefix}-save`}
      >
        <SaveIcon className="size-3.5" aria-hidden />
        {saveLabel}
      </Button>
    </div>
  );
}
