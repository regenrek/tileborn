import { useParams } from '@tanstack/react-router';
import {
  AssetLibraryReference,
  AttachmentAnchor,
  PlayerModelAnchor,
  PlayerModelClipSet,
  PlayerModelHitbox,
  PlayerModelRef,
  PlayerModelWorldSize,
  REQUIRED_PLAYER_MODEL_CLIP_KEYS,
  VisualAnchorPoint,
  validatePlayerModelRef,
  type ClipId,
  type PlayerModelClipKey,
} from '@tileborne/core';
import { Button, Input, Label, cn, typography } from '@tileborne/ui';
import {
  ActivityIcon,
  CrosshairIcon,
  RotateCcwIcon,
  SaveIcon,
  ShieldIcon,
  Trash2Icon,
  UserIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CloseableWorkspacePage } from '@/components/shell/closeable-workspace-page';
import {
  SpriteGeometryCanvas,
  type NormalizedPoint,
  type NormalizedRect,
  type SpriteGeometryHandle,
  type SpriteGeometryRect,
} from '@/components/visual-editor/sprite-geometry-canvas';
import { useUpdateProject } from '@/hooks/mutations';
import { useMap, useMaps, usePluginsList, useProject, useTilesetPack } from '@/hooks/queries';
import { PLUGIN_PLAYER_MODEL_POLICIES } from '@/lib/plugin-player-model-policies';
import { resolvePlayerModelPolicy } from '@/lib/player-model-policy';
import { diagnosePlayerModelPolicy } from '@/lib/visual-model-diagnostics';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

const DEFAULT_WORLD_SIZE = { width: 24, height: 32 } as const;

const clipKeyLabel = (key: PlayerModelClipKey): string =>
  key
    .split('-')
    .map((part) => (part.length === 0 ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
    .join(' ');

const numberValue = (value: string): number | undefined => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const modelWithPatch = (
  model: PlayerModelRef,
  patch: {
    readonly label?: string | undefined;
    readonly defaultClipId?: ClipId | undefined;
    readonly clips?: PlayerModelClipSet | undefined;
    readonly anchor?: NormalizedPoint | undefined;
    readonly hand?: NormalizedPoint | undefined;
    readonly hitbox?: NormalizedRect | undefined;
    readonly renderScale?: number | undefined;
    readonly worldSize?: { readonly width: number; readonly height: number } | undefined;
  },
): PlayerModelRef =>
  new PlayerModelRef({
    id: model.id,
    label: patch.label ?? model.label,
    ref: new AssetLibraryReference({
      ...model.ref,
      clipId: patch.defaultClipId ?? model.ref.clipId,
    }),
    defaultClipId: patch.defaultClipId ?? model.defaultClipId,
    clips: patch.clips ?? model.clips,
    anchor: new PlayerModelAnchor(patch.anchor ?? model.anchor),
    hitbox: new PlayerModelHitbox(patch.hitbox ?? model.hitbox),
    anchors:
      patch.hand === undefined
        ? model.anchors
        : {
            ...model.anchors,
            hand: new AttachmentAnchor({
              point: new VisualAnchorPoint(patch.hand),
              rotationDeg: model.anchors.hand?.rotationDeg ?? 0,
              zOffset: model.anchors.hand?.zOffset ?? 0,
            }),
          },
    ...(patch.renderScale ?? model.renderScale) === undefined
      ? {}
      : { renderScale: patch.renderScale ?? model.renderScale },
    worldSize:
      patch.worldSize === undefined && model.worldSize === undefined
        ? undefined
        : new PlayerModelWorldSize(patch.worldSize ?? model.worldSize ?? DEFAULT_WORLD_SIZE),
  });

const replaceModel = (
  models: readonly PlayerModelRef[],
  model: PlayerModelRef,
): readonly PlayerModelRef[] =>
  models.some((entry) => entry.id === model.id)
    ? models.map((entry) => (entry.id === model.id ? model : entry))
    : [...models, model];

const removeModel = (
  models: readonly PlayerModelRef[],
  modelId: string,
): readonly PlayerModelRef[] => models.filter((entry) => entry.id !== modelId);

const modelHandles = (
  model: PlayerModelRef | undefined,
  defaultHand: NormalizedPoint,
): readonly SpriteGeometryHandle[] =>
  model === undefined
    ? []
    : [
        { id: 'anchor', label: 'Anchor', kind: 'pivot', point: model.anchor },
        { id: 'hand', label: 'Hand', kind: 'hand', point: model.anchors.hand?.point ?? defaultHand },
      ];

const modelRects = (model: PlayerModelRef | undefined): readonly SpriteGeometryRect[] =>
  model === undefined
    ? []
    : [{ id: 'hitbox', label: 'Hitbox', kind: 'hitbox', rect: model.hitbox }];

export function PlayerModelEditorPage() {
  const { projectId } = useParams({ from: '/editor/projects/$projectId/player-models' });
  const projectQuery = useProject(projectId);
  const project = projectQuery.data?.project;
  const mapsQuery = useMaps(projectId);
  const firstMapId = mapsQuery.data?.maps[0]?.id;
  const mapQuery = useMap(projectId, firstMapId);
  const pluginsQuery = usePluginsList();
  const updateProject = useUpdateProject();
  const enabledPluginIds = useMemo(
    () =>
      (pluginsQuery.data?.plugins ?? [])
        .filter((plugin) => plugin.enabled)
        .map((plugin) => plugin.id),
    [pluginsQuery.data?.plugins],
  );
  const policy = useMemo(() => {
    const map = mapQuery.data?.map;
    if (map === undefined) {
      return undefined;
    }
    return resolvePlayerModelPolicy(enabledPluginIds, PLUGIN_PLAYER_MODEL_POLICIES, {
      map,
      project,
    });
  }, [enabledPluginIds, mapQuery.data?.map, project]);
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(undefined);
  const [draftModel, setDraftModel] = useState<PlayerModelRef | undefined>(undefined);
  const [activeClipKey, setActiveClipKey] = useState<PlayerModelClipKey>('idle');
  const [isDirty, setIsDirty] = useState(false);
  const selectedModel =
    policy?.models.find((model) => model.id === selectedModelId) ?? policy?.models[0];
  const packQuery = useTilesetPack(draftModel?.ref.packId);
  const placeable = useMemo(() => {
    if (draftModel === undefined) {
      return undefined;
    }
    return packQuery.data?.placeables?.find((entry) => String(entry.id) === draftModel.ref.refId);
  }, [draftModel, packQuery.data]);
  const clipOptions = placeable?.clips ?? [];
  const validationIssues = useMemo(
    () => (draftModel === undefined ? [] : validatePlayerModelRef(draftModel)),
    [draftModel],
  );
  const authoringDiagnostics = useMemo(() => {
    if (policy === undefined) {
      return [];
    }
    const models =
      draftModel === undefined ? policy.models : replaceModel(policy.models, draftModel);
    return diagnosePlayerModelPolicy({ ...policy, models }).filter(
      (diagnostic) => diagnostic.modelId === draftModel?.id || diagnostic.modelId === undefined,
    );
  }, [draftModel, policy]);
  const requiredClipKeys = policy?.requiredClipKeys ?? REQUIRED_PLAYER_MODEL_CLIP_KEYS;
  const defaultGeometry = policy?.defaultGeometry ?? {
    anchor: { x: 0.5, y: 0.86 },
    hand: { x: 0.64, y: 0.56 },
    hitbox: { x: 0.28, y: 0.18, width: 0.44, height: 0.66 },
    renderScale: 1,
    worldSize: DEFAULT_WORLD_SIZE,
  };
  const handles = useMemo(
    () => modelHandles(draftModel, defaultGeometry.hand),
    [draftModel, defaultGeometry.hand],
  );
  const rects = useMemo(() => modelRects(draftModel), [draftModel]);
  const worldSize = draftModel?.worldSize ?? DEFAULT_WORLD_SIZE;
  const activeClip = draftModel?.clips[activeClipKey];

  useEffect(() => {
    if (selectedModel === undefined) {
      setDraftModel(undefined);
      setSelectedModelId(undefined);
      setIsDirty(false);
      return;
    }
    setSelectedModelId((current) => current ?? selectedModel.id);
    setDraftModel(selectedModel);
    setIsDirty(false);
  }, [selectedModel]);

  const updateDraft = (patch: Parameters<typeof modelWithPatch>[1]) => {
    setDraftModel((current) => {
      if (current === undefined) {
        return current;
      }
      setIsDirty(true);
      return modelWithPatch(current, patch);
    });
  };

  const saveDraft = async () => {
    if (project === undefined || policy === undefined || draftModel === undefined) {
      return;
    }
    if (policy.applyModels === undefined) {
      notifyError('The active player-model policy is read-only');
      return;
    }
    if (validationIssues.length > 0) {
      notifyError('Fix player model validation issues before saving');
      return;
    }
    try {
      await updateProject.mutateAsync({
        project: policy.applyModels(project, replaceModel(policy.models, draftModel)),
      });
      setIsDirty(false);
      notifySuccess(`${draftModel.label} saved`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to save player model');
    }
  };

  const removeDraft = async () => {
    if (project === undefined || policy === undefined || draftModel === undefined) {
      return;
    }
    if (policy.applyModels === undefined) {
      notifyError('The active player-model policy is read-only');
      return;
    }
    try {
      await updateProject.mutateAsync({
        project: policy.applyModels(project, removeModel(policy.models, draftModel.id)),
      });
      notifySuccess(`${draftModel.label} removed`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to remove player model');
    }
  };

  return (
    <CloseableWorkspacePage
      title="Player Model Editor"
      description="Author playable model geometry, clips, and runtime metadata for the active project."
      maxWidthClassName="max-w-7xl"
      data-testid="player-model-editor-page"
    >
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(18rem,24rem)_1fr]">
        <section
          className="min-w-0 rounded-md border border-border bg-card"
          aria-labelledby="player-model-list-title"
        >
          <div className="border-b border-border px-3 py-2">
            <h2 id="player-model-list-title" className={typography.panelTitle}>
              Models
            </h2>
            <p className={typography.rowMeta}>
              {policy === undefined ? 'No active policy' : `${policy.mode} · ${policy.pluginId}`}
            </p>
          </div>
          {policy === undefined || policy.models.length === 0 ? (
            <div className="px-3 py-6 text-center" data-testid="player-model-editor-empty">
              <UserIcon className="mx-auto size-5 text-muted-foreground" aria-hidden />
              <p className={cn('mt-2', typography.rowMeta)}>No player models</p>
            </div>
          ) : (
            <ul className="divide-y divide-border" data-testid="player-model-editor-list">
              {policy.models.map((model) => {
                const selected = model.id === draftModel?.id;
                return (
                  <li key={model.id}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left',
                        selected ? 'bg-accent/55' : 'hover:bg-accent/35',
                      )}
                      onClick={() => {
                        setSelectedModelId(model.id);
                        setDraftModel(model);
                        setIsDirty(false);
                      }}
                      data-testid={`player-model-editor-row-${model.id}`}
                      aria-pressed={selected}
                    >
                      <UserIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate', typography.rowTitle)}>{model.label}</p>
                        <p className={cn('truncate', typography.rowMeta)}>{model.id}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="min-w-0 space-y-3" data-testid="player-model-editor-canvas-host">
          <section className="rounded-md border border-border bg-card p-3">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="min-w-0 space-y-1 xl:col-span-2">
                  <Label htmlFor="player-model-label">Label</Label>
                  <Input
                    id="player-model-label"
                    value={draftModel?.label ?? ''}
                    disabled={draftModel === undefined}
                    onChange={(event) => updateDraft({ label: event.currentTarget.value })}
                    data-testid="player-model-editor-label"
                  />
                </div>
                <NumberInput
                  label="Render scale"
                  value={draftModel?.renderScale ?? 1}
                  min={0.05}
                  step={0.05}
                  onChange={(renderScale) => updateDraft({ renderScale })}
                  testId="player-model-editor-render-scale"
                />
                <NumberInput
                  label="World width"
                  value={worldSize.width}
                  min={1}
                  step={1}
                  onChange={(width) => updateDraft({ worldSize: { ...worldSize, width } })}
                  testId="player-model-editor-world-width"
                />
                <NumberInput
                  label="World height"
                  value={worldSize.height}
                  min={1}
                  step={1}
                  onChange={(height) => updateDraft({ worldSize: { ...worldSize, height } })}
                  testId="player-model-editor-world-height"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!isDirty || selectedModel === undefined}
                  onClick={() => {
                    setDraftModel(selectedModel);
                    setIsDirty(false);
                  }}
                  data-testid="player-model-editor-revert"
                >
                  <RotateCcwIcon className="size-4" aria-hidden />
                  Revert
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={draftModel === undefined || updateProject.isPending}
                  onClick={() => void removeDraft()}
                  data-testid="player-model-editor-remove"
                >
                  <Trash2Icon className="size-4" aria-hidden />
                  Remove
                </Button>
                <Button
                  type="button"
                  disabled={
                    draftModel === undefined ||
                    updateProject.isPending ||
                    validationIssues.length > 0 ||
                    !isDirty
                  }
                  onClick={() => void saveDraft()}
                  data-testid="player-model-editor-save"
                >
                  <SaveIcon className="size-4" aria-hidden />
                  Save
                </Button>
              </div>
            </div>
          </section>

          <section className="grid gap-3 rounded-md border border-border bg-card p-3 lg:grid-cols-[1fr_18rem]">
            <div className="min-w-0">
              <h2 className={typography.panelTitle}>Clip bindings</h2>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {requiredClipKeys.map((key) => (
                  <label key={key} className="min-w-0 space-y-1">
                    <span className={typography.rowMeta}>{clipKeyLabel(key)}</span>
                    <select
                      value={String(draftModel?.clips[key] ?? '')}
                      disabled={draftModel === undefined || clipOptions.length === 0}
                      onChange={(event) =>
                        updateDraft({
                          clips: new PlayerModelClipSet({
                            ...draftModel!.clips,
                            [key]: event.currentTarget.value as ClipId,
                          }),
                          defaultClipId:
                            key === activeClipKey
                              ? (event.currentTarget.value as ClipId)
                              : draftModel!.defaultClipId,
                        })
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      data-testid={`player-model-editor-clip-${key}`}
                    >
                      {clipOptions.map((clip) => (
                        <option key={String(clip.id)} value={String(clip.id)}>
                          {clip.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <ModelPreview
              label={draftModel?.label ?? 'No model'}
              activeClipKey={activeClipKey}
              activeClipId={activeClip === undefined ? '-' : String(activeClip)}
              renderScale={draftModel?.renderScale ?? 1}
              worldSize={worldSize}
            />
          </section>

          <SpriteGeometryCanvas
            title="Model Geometry"
            handles={handles}
            rects={rects}
            snapStep={0.01}
            frames={requiredClipKeys.map((key) => ({ id: key, label: clipKeyLabel(key) }))}
            activeFrameId={activeClipKey}
            onFrameChange={(frameId) => setActiveClipKey(frameId as PlayerModelClipKey)}
            onHandleChange={(id, point) =>
              updateDraft(id === 'hand' ? { hand: point } : { anchor: point })
            }
            onRectChange={(_, rect) => updateDraft({ hitbox: rect })}
            onResetDefaults={() =>
              updateDraft({
                anchor: defaultGeometry.anchor,
                hand: defaultGeometry.hand,
                hitbox: defaultGeometry.hitbox,
                renderScale: defaultGeometry.renderScale ?? 1,
                worldSize: defaultGeometry.worldSize ?? DEFAULT_WORLD_SIZE,
              })
            }
          />

          <div className="grid gap-2 md:grid-cols-3">
            <GeometryStat
              icon={ActivityIcon}
              label="Clips"
              value={draftModel === undefined ? '-' : `${requiredClipKeys.length}`}
            />
            <GeometryStat
              icon={ShieldIcon}
              label="Hitbox"
              value={draftModel === undefined ? '-' : `${draftModel.hitbox.width.toFixed(2)} x ${draftModel.hitbox.height.toFixed(2)}`}
            />
            <GeometryStat
              icon={CrosshairIcon}
              label="Hand"
              value={
                draftModel?.anchors.hand === undefined
                  ? '-'
                  : `${draftModel.anchors.hand.point.x.toFixed(2)}, ${draftModel.anchors.hand.point.y.toFixed(2)}`
              }
            />
          </div>

          {validationIssues.length === 0 ? null : (
            <section className="rounded-md border border-destructive/50 bg-destructive/10 p-3" data-testid="player-model-editor-validation">
              <p className={typography.panelTitle}>Validation</p>
              <ul className="mt-2 space-y-1">
                {validationIssues.map((issue) => (
                  <li key={`${issue.path}:${issue.message}`} className={typography.bodyMicro}>
                    <span className="font-medium">{issue.path}</span>: {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {authoringDiagnostics.length === 0 ? null : (
            <section
              className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3"
              data-testid="player-model-editor-diagnostics"
            >
              <p className={typography.panelTitle}>Authoring diagnostics</p>
              <ul className="mt-2 space-y-1">
                {authoringDiagnostics.map((diagnostic) => (
                  <li key={`${diagnostic.code}:${diagnostic.path}:${diagnostic.message}`} className={typography.bodyMicro}>
                    <span className="font-medium">{diagnostic.severity}</span>{' '}
                    {diagnostic.path}: {diagnostic.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </CloseableWorkspacePage>
  );
}

interface NumberInputProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
  readonly testId: string;
}

function NumberInput({ label, value, min, step, onChange, testId }: NumberInputProps) {
  return (
    <div className="min-w-0 space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : min}
        min={min}
        step={step}
        onChange={(event) => {
          const next = numberValue(event.currentTarget.value);
          if (next !== undefined) {
            onChange(next);
          }
        }}
        data-testid={testId}
      />
    </div>
  );
}

interface ModelPreviewProps {
  readonly label: string;
  readonly activeClipKey: PlayerModelClipKey;
  readonly activeClipId: string;
  readonly renderScale: number;
  readonly worldSize: { readonly width: number; readonly height: number };
}

function ModelPreview({
  label,
  activeClipKey,
  activeClipId,
  renderScale,
  worldSize,
}: ModelPreviewProps) {
  return (
    <div className="rounded-md border border-border bg-background p-3" data-testid="player-model-preview">
      <p className={cn('truncate', typography.rowTitle)}>{label}</p>
      <p className={cn('truncate', typography.rowMeta)}>
        {clipKeyLabel(activeClipKey)} · {activeClipId}
      </p>
      <svg
        viewBox="0 0 220 160"
        className="mt-3 h-36 w-full rounded-md border border-border bg-card"
        role="img"
        aria-label="Player model preview"
        data-render-scale={renderScale.toFixed(2)}
        data-world-width={worldSize.width.toFixed(2)}
        data-world-height={worldSize.height.toFixed(2)}
      >
        <rect x="0" y="0" width="220" height="160" fill="rgba(12,16,24,.96)" />
        <ellipse cx="110" cy="126" rx="44" ry="12" fill="#020617" opacity="0.45" />
        <rect x="82" y="38" width="56" height="84" rx="24" fill="#e2e8f0" />
        <circle cx="110" cy="44" r="26" fill="#fef3c7" />
        <circle cx="99" cy="42" r="3" fill="#0f172a" />
        <circle cx="121" cy="42" r="3" fill="#0f172a" />
        <line x1="146" y1="78" x2="184" y2="70" stroke="#f97316" strokeWidth="5" strokeLinecap="round" />
        <circle cx="184" cy="70" r="5" fill="#ef4444" />
      </svg>
    </div>
  );
}

interface GeometryStatProps {
  readonly icon: typeof ActivityIcon;
  readonly label: string;
  readonly value: string;
}

function GeometryStat({ icon: Icon, label, value }: GeometryStatProps) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5">
      <span className={cn('flex min-w-0 items-center gap-1.5 truncate', typography.rowMeta)}>
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </span>
      <span className={cn('shrink-0', typography.rowTitle)}>{value}</span>
    </div>
  );
}
