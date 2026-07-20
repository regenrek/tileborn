import { useParams } from '@tanstack/react-router';
import type { PackId, ProjectId } from '@tileborne/core';
import {
  defaultRuntimeAudioSettings,
  RUNTIME_AUDIO_BINDING_KEYS,
  type RuntimeAudioBindingKey,
  type RuntimeAudioClassification,
  type RuntimeAudioSourceDefinition,
} from '@tileborne/runtime';
import { createBrowserRuntimeAudioEngine } from '@tileborne/game-client';
import { Button, ScrollArea } from '@tileborne/ui';
import { useEffect, useMemo, useState } from 'react';

import {
  useApplyProjectAudioCommand,
  usePreviewProjectAudio,
  useSaveProjectAudio,
} from '@/hooks/mutations';
import { useAssetPackAssets, useAssetPacks, useProjectAudio } from '@/hooks/queries';

const classifications: readonly RuntimeAudioClassification[] = [
  'music',
  'weapon',
  'item',
  'player',
  'environment',
  'match',
  'ui',
  'sfx',
];

export function AudioPage() {
  const { projectId: routeProjectId } = useParams({ from: '/editor/projects/$projectId/audio' });
  const projectId = routeProjectId as ProjectId;
  const audioQuery = useProjectAudio(projectId);
  const assetPacksQuery = useAssetPacks();
  const saveAudio = useSaveProjectAudio();
  const applyAudio = useApplyProjectAudioCommand();
  const previewAudio = usePreviewProjectAudio();
  const [label, setLabel] = useState('Menu Loop');
  const [selectedPackId, setSelectedPackId] = useState('');
  const selectedPackAssetsQuery = useAssetPackAssets(selectedPackId);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [classification, setClassification] = useState<RuntimeAudioClassification>('music');
  const [binding, setBinding] = useState<RuntimeAudioBindingKey>('shell.menuMusic');
  const [masterVolume, setMasterVolume] = useState(1);
  const [musicVolume, setMusicVolume] = useState(0.8);
  const [sfxVolume, setSfxVolume] = useState(0.85);

  useEffect(() => {
    document.title = 'Audio';
  }, []);

  const audioDocument = audioQuery.data?.document;
  const assets = audioDocument?.assets ?? [];
  const boundLabels = useMemo(
    () => new Set(Object.values(audioDocument?.bindings ?? {})),
    [audioDocument],
  );
  const diagnostics =
    applyAudio.data?.projection.diagnostics ?? previewAudio.data?.diagnostics ?? [];
  const assetPacks = assetPacksQuery.data?.packs ?? [];
  const selectedPack = assetPacks.find((pack) => pack.id === selectedPackId);
  const audioAssetChoices = useMemo(
    () =>
      (selectedPackAssetsQuery.data?.assets ?? []).filter((asset) =>
        asset.mime.startsWith('audio/'),
      ),
    [selectedPackAssetsQuery.data?.assets],
  );
  const selectedAsset =
    audioAssetChoices.find((asset) => asset.id === selectedAssetId) ?? audioAssetChoices[0];

  useEffect(() => {
    if (audioDocument === undefined) return;
    setMasterVolume(audioDocument.settings.masterVolume);
    setMusicVolume(audioDocument.settings.busVolumes?.['project.music'] ?? 0.8);
    setSfxVolume(audioDocument.settings.busVolumes?.['project.sfx'] ?? 0.85);
  }, [audioDocument]);

  useEffect(() => {
    if (selectedPackId.length > 0 || assetPacks.length === 0) return;
    setSelectedPackId(assetPacks[0]?.id ?? '');
  }, [assetPacks, selectedPackId]);

  useEffect(() => {
    if (selectedAsset !== undefined && selectedAssetId !== selectedAsset.id) {
      setSelectedAssetId(selectedAsset.id);
    }
  }, [selectedAsset, selectedAssetId]);

  const apply = (command: Parameters<typeof window.tileborne.audio.apply>[0]['command']) =>
    applyAudio.mutate({ projectId, command });

  const sourceFromFields = () => ({
    ...(selectedAsset === undefined ? {} : { assetId: selectedAsset.id }),
    ...(selectedPack === undefined ? {} : { packId: selectedPack.id }),
    ...(selectedPack === undefined ? {} : { packVersion: selectedPack.version }),
    ...(selectedAsset === undefined ? {} : { path: selectedAsset.path }),
    ...(selectedAsset === undefined ? {} : { mime: selectedAsset.mime }),
  });

  const playPreview = async (source: RuntimeAudioSourceDefinition) => {
    const sourcePackId = source.packId ?? selectedPackId;
    const previewSource =
      sourcePackId.length > 0 && source.path !== undefined
        ? {
            ...source,
            url: (
              await window.tileborne.assets.getAssetDataUrl({
                packId: sourcePackId as PackId,
                assetPath: source.path,
              })
            ).dataUrl,
          }
        : source;
    const engine = createBrowserRuntimeAudioEngine({
      buses: [{ id: 'project.preview', label: 'Preview', kind: 'sfx', defaultVolume: 1 }],
      cues: [
        {
          id: 'project.preview',
          label: label.trim() || 'Preview',
          busId: 'project.preview',
          defaultVolume: 1,
          source: previewSource,
          maxOverlap: 1,
        },
      ],
      settings: defaultRuntimeAudioSettings(),
    });
    engine.playCue('project.preview');
    window.setTimeout(() => engine.dispose(), 5_000);
  };

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-8" data-testid="audio-page">
        <div>
          <h1 className="text-xl font-semibold">Audio</h1>
          <p className="text-sm text-muted-foreground">
            Import, preview, classify, bind and save project music/SFX by labels.
          </p>
        </div>

        <section className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Label
            <input
              className="rounded border border-input bg-input/20 px-2 py-1"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
              data-testid="audio-label"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Asset pack
            <select
              className="rounded border border-input bg-input/20 px-2 py-1"
              value={selectedPackId}
              onChange={(event) => {
                setSelectedPackId(event.currentTarget.value);
                setSelectedAssetId('');
              }}
              data-testid="audio-pack-select"
            >
              {assetPacks.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name} · {pack.licenseSpdxId}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Licensed audio asset
            <select
              className="rounded border border-input bg-input/20 px-2 py-1"
              value={selectedAsset?.id ?? ''}
              onChange={(event) => setSelectedAssetId(event.currentTarget.value)}
              data-testid="audio-asset-select"
            >
              {audioAssetChoices.length === 0 ? (
                <option value="">No audio assets in selected pack</option>
              ) : (
                audioAssetChoices.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.path} · {asset.mime}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Classification
            <select
              className="rounded border border-input bg-input/20 px-2 py-1"
              value={classification}
              onChange={(event) =>
                setClassification(event.currentTarget.value as RuntimeAudioClassification)
              }
              data-testid="audio-classification"
            >
              {classifications.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Binding
            <select
              className="rounded border border-input bg-input/20 px-2 py-1"
              value={binding}
              onChange={(event) => setBinding(event.currentTarget.value as RuntimeAudioBindingKey)}
              data-testid="audio-binding"
            >
              {RUNTIME_AUDIO_BINDING_KEYS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <p
            className="rounded border border-border bg-background/50 p-2 text-xs text-muted-foreground sm:col-span-2"
            data-testid="audio-selected-license"
          >
            Source: {selectedAsset?.path ?? 'none'} · License:{' '}
            {selectedPack?.licenseSpdxId ?? 'unknown'} · Pack: {selectedPack?.id ?? 'none'}
          </p>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button
              disabled={selectedAsset === undefined}
              onClick={() =>
                apply({
                  type: 'import',
                  label,
                  classification,
                  source: sourceFromFields(),
                })
              }
              data-testid="audio-import"
            >
              Import / replace label
            </Button>
            <Button
              variant="outline"
              onClick={() => apply({ type: 'classify', label, classification })}
            >
              Classify
            </Button>
            <Button
              variant="outline"
              disabled={selectedAsset === undefined}
              onClick={() =>
                apply({
                  type: 'replace',
                  label,
                  source: sourceFromFields(),
                })
              }
              data-testid="audio-replace"
            >
              Replace source
            </Button>
            <Button
              variant="outline"
              onClick={() => apply({ type: 'bind', label, binding })}
              data-testid="audio-bind"
            >
              Bind
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                previewAudio.mutate(
                  { projectId, label },
                  {
                    onSuccess: (data) => {
                      if (data.source !== undefined) void playPreview(data.source);
                    },
                  },
                )
              }
              data-testid="audio-preview"
            >
              Preview
            </Button>
            <Button variant="outline" onClick={() => apply({ type: 'remove', label })}>
              Remove
            </Button>
            <Button
              variant="secondary"
              disabled={audioDocument === undefined}
              onClick={() =>
                audioDocument && saveAudio.mutate({ projectId, document: audioDocument })
              }
              data-testid="audio-save"
            >
              Save
            </Button>
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">
            Master volume
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={masterVolume}
              onChange={(event) => setMasterVolume(Number(event.currentTarget.value))}
              data-testid="audio-master-volume"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Music volume
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={musicVolume}
              onChange={(event) => setMusicVolume(Number(event.currentTarget.value))}
              data-testid="audio-music-volume"
            />
          </label>
          <label className="grid gap-1 text-sm">
            SFX volume
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={sfxVolume}
              onChange={(event) => setSfxVolume(Number(event.currentTarget.value))}
              data-testid="audio-sfx-volume"
            />
          </label>
          <Button
            className="sm:col-span-3"
            variant="secondary"
            disabled={audioDocument === undefined}
            onClick={() =>
              audioDocument &&
              saveAudio.mutate({
                projectId,
                document: {
                  ...audioDocument,
                  settings: {
                    ...audioDocument.settings,
                    masterVolume,
                    busVolumes: {
                      ...(audioDocument.settings.busVolumes ?? {}),
                      'project.music': musicVolume,
                      'project.sfx': sfxVolume,
                    },
                  },
                },
              })
            }
            data-testid="audio-save-volume"
          >
            Save volume settings
          </Button>
        </section>

        {previewAudio.data !== undefined ? (
          <p
            className="rounded border border-border bg-card p-3 text-sm"
            data-testid="audio-preview-status"
          >
            Preview {previewAudio.data.playable ? 'ready' : 'blocked'}
            {previewAudio.data.source?.url === undefined
              ? ''
              : ` · ${previewAudio.data.source.url}`}
          </p>
        ) : null}

        {diagnostics.length > 0 ? (
          <section className="rounded-lg border border-destructive/40 bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Audio diagnostics</h2>
            <ul className="space-y-1 text-sm">
              {diagnostics.map((diagnostic) => (
                <li key={`${diagnostic.code}:${diagnostic.path}`}>
                  {diagnostic.path}: {diagnostic.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Imported labels</h2>
          {assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audio labels yet.</p>
          ) : (
            <ul className="space-y-2">
              {assets.map((asset) => (
                <li
                  key={asset.label}
                  className="flex flex-wrap items-center gap-2 rounded border border-border px-3 py-2 text-sm"
                  data-testid="audio-asset-row"
                >
                  <span className="font-medium">{asset.label}</span>
                  <span className="text-muted-foreground">{asset.classification}</span>
                  {boundLabels.has(asset.label) ? <span>bound</span> : null}
                  <code className="ml-auto text-xs text-muted-foreground">
                    {asset.source.url ??
                      asset.source.path ??
                      asset.source.assetId ??
                      'missing source'}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
