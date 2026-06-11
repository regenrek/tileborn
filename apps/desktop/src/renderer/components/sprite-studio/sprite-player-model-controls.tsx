import { REQUIRED_PLAYER_MODEL_CLIP_KEYS } from '@tileborne/core';
import { Button, Input, Label, Switch, cn } from '@tileborne/ui';
import { TargetIcon, WandSparklesIcon } from 'lucide-react';

export interface PlayerModelGeometryDraft {
  readonly renderScale: number;
  readonly hitboxX: number;
  readonly hitboxY: number;
  readonly hitboxW: number;
  readonly hitboxH: number;
  readonly handX: number;
  readonly handY: number;
}

export const DEFAULT_PLAYER_MODEL_GEOMETRY: PlayerModelGeometryDraft = {
  renderScale: 1,
  hitboxX: 0.25,
  hitboxY: 0.1,
  hitboxW: 0.5,
  hitboxH: 0.85,
  handX: 0.64,
  handY: 0.56,
};

export const missingPlayerModelClipNames = (
  clipNames: readonly string[],
): readonly string[] => {
  const normalized = new Set(clipNames.map((name) => name.trim().toLowerCase()));
  return REQUIRED_PLAYER_MODEL_CLIP_KEYS.filter((key) => !normalized.has(key));
};

export const toPlayerModelImportMetadata = (geometry: PlayerModelGeometryDraft) => ({
  renderScale: geometry.renderScale,
  hitbox: {
    x: geometry.hitboxX,
    y: geometry.hitboxY,
    width: geometry.hitboxW,
    height: geometry.hitboxH,
  },
  hand: {
    x: geometry.handX,
    y: geometry.handY,
  },
});

interface SpritePlayerModelControlsProps {
  readonly enabled: boolean;
  readonly geometry: PlayerModelGeometryDraft;
  readonly clipNames: readonly string[];
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onGeometryChange: (geometry: PlayerModelGeometryDraft) => void;
  readonly onSeedClips: () => void;
}

const boundedNumber = (value: string, min: number, max: number): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min;
};

export function SpritePlayerModelControls({
  enabled,
  geometry,
  clipNames,
  onEnabledChange,
  onGeometryChange,
  onSeedClips,
}: SpritePlayerModelControlsProps) {
  const missingClips = missingPlayerModelClipNames(clipNames);
  const update = (patch: Partial<PlayerModelGeometryDraft>) =>
    onGeometryChange({ ...geometry, ...patch });
  const numberField = (
    label: string,
    value: number,
    onChange: (next: number) => void,
    testId: string,
    min = 0,
    max = 1,
    step = 0.01,
  ) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(boundedNumber(event.target.value, min, max))}
        className="h-8"
        data-testid={testId}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2" data-testid="sprite-player-model-controls">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
          <TargetIcon className="size-3.5" aria-hidden />
          Player model
        </Label>
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          data-testid="sprite-player-model-enabled"
        />
      </div>

      {enabled ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1" data-testid="sprite-player-model-clip-status">
              {REQUIRED_PLAYER_MODEL_CLIP_KEYS.map((key) => {
                const missing = missingClips.includes(key);
                return (
                  <span
                    key={key}
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[10px] uppercase',
                      missing
                        ? 'border-destructive/50 text-destructive'
                        : 'border-emerald-500/50 text-emerald-600',
                    )}
                    data-missing={missing ? 'true' : 'false'}
                  >
                    {key}
                  </span>
                );
              })}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2"
              onClick={onSeedClips}
              data-testid="sprite-player-model-seed-clips"
            >
              <WandSparklesIcon className="size-3.5" aria-hidden />
              Seed clips
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {numberField(
              'Scale',
              geometry.renderScale,
              (renderScale) => update({ renderScale }),
              'sprite-player-render-scale',
              0.25,
              4,
              0.05,
            )}
            {numberField('Hitbox X', geometry.hitboxX, (hitboxX) => update({ hitboxX }), 'sprite-player-hitbox-x')}
            {numberField('Hitbox Y', geometry.hitboxY, (hitboxY) => update({ hitboxY }), 'sprite-player-hitbox-y')}
            {numberField('Hitbox W', geometry.hitboxW, (hitboxW) => update({ hitboxW }), 'sprite-player-hitbox-w')}
            {numberField('Hitbox H', geometry.hitboxH, (hitboxH) => update({ hitboxH }), 'sprite-player-hitbox-h')}
            {numberField('Hand X', geometry.handX, (handX) => update({ handX }), 'sprite-player-hand-x')}
            {numberField('Hand Y', geometry.handY, (handY) => update({ handY }), 'sprite-player-hand-y')}
          </div>
        </>
      ) : null}
    </div>
  );
}
