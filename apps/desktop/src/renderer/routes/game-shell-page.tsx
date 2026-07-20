import { useParams, useSearch } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
import {
  GAME_SHELL_ACTION_TYPES,
  GAME_SHELL_REGISTERED_EVENTS,
  type GameShellActionType,
  type GameShellAssetKind,
  type GameShellRegisteredEvent,
  type GameShellScreenDefinition,
} from '@tileborne/runtime';
import { Button, ScrollArea, cn, typography } from '@tileborne/ui';
import { ArrowDownIcon, ArrowUpIcon, SaveIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useApplyProjectGameShellCommand, useSaveProjectGameShell } from '@/hooks/mutations';
import { useAssetPackAssets, useAssetPacks, useProjectGameShell } from '@/hooks/queries';

const layouts: readonly GameShellScreenDefinition['layout'][] = ['center', 'split', 'stack'];
const spacingTokens = ['compact', 'comfortable', 'spacious'] as const;
const motionTokens = ['standard', 'reduced'] as const;

export function GameShellPage() {
  const { projectId: routeProjectId } = useParams({
    from: '/editor/projects/$projectId/game-shell',
  });
  const search = useSearch({ from: '/editor/projects/$projectId/game-shell' });
  const projectId = routeProjectId as ProjectId;
  const shellQuery = useProjectGameShell(projectId);
  const saveShell = useSaveProjectGameShell();
  const applyShell = useApplyProjectGameShellCommand();
  const assetPacksQuery = useAssetPacks();
  const [selectedScreenId, setSelectedScreenId] = useState('title');
  const [selectedPackId, setSelectedPackId] = useState('');
  const selectedPackAssetsQuery = useAssetPackAssets(selectedPackId);
  const [actionLabel, setActionLabel] = useState('New action');
  const [actionType, setActionType] = useState<GameShellActionType>('navigate');
  const [actionTarget, setActionTarget] = useState('main-menu');
  const [actionEvent, setActionEvent] = useState<GameShellRegisteredEvent>('shell.action.invoked');

  useEffect(() => {
    document.title = 'Game Shell';
  }, []);

  const shellDocument = shellQuery.data?.document;
  const projection = applyShell.data?.projection ?? shellQuery.data?.projection;
  const screens = projection?.screens ?? shellDocument?.screens ?? [];
  const selectedScreen = screens.find((screen) => screen.id === selectedScreenId) ?? screens[0];
  const tokens = projection?.tokens ?? shellDocument?.tokens;
  const diagnostics = projection?.diagnostics ?? [];
  const entryScreenId = projection?.entryScreenId ?? shellDocument?.entryScreenId ?? '';
  const assetPacks = assetPacksQuery.data?.packs ?? [];
  const selectedPack = assetPacks.find((pack) => pack.id === selectedPackId);
  const assetChoices = selectedPackAssetsQuery.data?.assets ?? [];
  const backgroundChoices = useMemo(
    () => assetChoices.filter((asset) => asset.mime.startsWith('image/')),
    [assetChoices],
  );
  const fontChoices = useMemo(
    () =>
      assetChoices.filter(
        (asset) => asset.mime.startsWith('font/') || asset.mime === 'application/font-woff2',
      ),
    [assetChoices],
  );
  const focusPath = search.path;
  const focusedScreenId = useMemo(() => {
    const match = /^shell\.screens\.([^.]+)/.exec(focusPath ?? '');
    return match?.[1];
  }, [focusPath]);
  const focusClass = (path: string) =>
    focusPath === path ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : '';

  useEffect(() => {
    if (selectedPackId.length > 0 || assetPacks.length === 0) return;
    setSelectedPackId(assetPacks[0]?.id ?? '');
  }, [assetPacks, selectedPackId]);

  useEffect(() => {
    if (focusedScreenId !== undefined && screens.some((screen) => screen.id === focusedScreenId)) {
      setSelectedScreenId(focusedScreenId);
    }
  }, [focusedScreenId, screens]);

  useEffect(() => {
    if (selectedScreen !== undefined)
      setActionTarget(selectedScreen.id === 'main-menu' ? 'settings' : 'main-menu');
  }, [selectedScreen?.id]);

  const apply = (command: Parameters<typeof window.tileborne.gameShell.apply>[0]['command']) =>
    applyShell.mutate({ projectId, command });

  const registerAndAssignAsset = (kind: GameShellAssetKind, assetId: string) => {
    if (selectedScreen === undefined || selectedPack === undefined) return;
    const asset = (kind === 'background' ? backgroundChoices : fontChoices).find(
      (entry) => entry.id === assetId,
    );
    if (asset === undefined) return;
    applyShell.mutate(
      {
        projectId,
        command: {
          type: 'register-asset',
          asset: {
            assetId: asset.id,
            packId: selectedPack.id,
            packVersion: selectedPack.version,
            path: asset.path,
            mime: asset.mime,
            kind,
          },
        },
      },
      {
        onSuccess: () =>
          apply({
            type: 'set-screen-asset',
            screenId: selectedScreen.id,
            slot: kind,
            assetId: asset.id,
          }),
      },
    );
  };

  const moveScreen = (screenId: string, delta: -1 | 1) => {
    const order = [...(projection?.screenOrder ?? shellDocument?.screenOrder ?? [])];
    const index = order.indexOf(screenId);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    [order[index], order[nextIndex]] = [order[nextIndex]!, order[index]!];
    apply({ type: 'set-screen-order', screenOrder: order });
  };

  const upsertAction = () => {
    if (selectedScreen === undefined) return;
    const id = `${selectedScreen.id}.${
      actionLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'action'
    }`;
    apply({
      type: 'upsert-action',
      screenId: selectedScreen.id,
      action: {
        id,
        label: actionLabel,
        type: actionType,
        ...(actionType === 'navigate' ? { targetScreenId: actionTarget } : {}),
        ...(actionType === 'emit-event' ? { event: actionEvent } : {}),
      },
    });
  };

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid w-full max-w-6xl gap-5 p-8" data-testid="game-shell-page">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Game Shell</h1>
            <p className="text-sm text-muted-foreground">
              Compose title, menu, loading, pause, settings, and results screens.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                apply({
                  type: 'apply-plugin-defaults',
                  pluginId: shellDocument?.pluginId ?? 'tileborne.default',
                })
              }
              data-testid="game-shell-plugin-defaults"
            >
              Plugin defaults
            </Button>
            <Button
              disabled={shellDocument === undefined}
              onClick={() =>
                shellDocument && saveShell.mutate({ projectId, document: shellDocument })
              }
              data-testid="game-shell-save"
            >
              <SaveIcon aria-hidden className="size-4" />
              Save
            </Button>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
          <section className="rounded-lg border border-border bg-card p-3">
            <h2 className={typography.panelTitle}>Screen order</h2>
            <div className="mt-3 grid gap-2">
              {screens.map((screen, index) => (
                <div key={screen.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-1">
                  <button
                    type="button"
                    className={cn(
                      'rounded border px-2 py-1.5 text-left text-sm',
                      selectedScreen?.id === screen.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border',
                      focusClass(`shell.screens.${screen.id}`),
                    )}
                    onClick={() => setSelectedScreenId(screen.id)}
                    data-testid="game-shell-screen"
                    data-shell-path={`shell.screens.${screen.id}`}
                    data-focused={focusPath === `shell.screens.${screen.id}`}
                  >
                    {screen.title}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === 0}
                    aria-label={`Move ${screen.title} up`}
                    onClick={() => moveScreen(screen.id, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === screens.length - 1}
                    aria-label={`Move ${screen.title} down`}
                    onClick={() => moveScreen(screen.id, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 rounded-lg border border-border bg-card p-4">
            {selectedScreen === undefined ? null : (
              <>
                <label className="grid gap-1 text-sm">
                  Entry screen
                  <select
                    className="rounded border border-input bg-input/20 px-2 py-1"
                    value={entryScreenId}
                    onChange={(event) =>
                      apply({ type: 'set-entry-screen', screenId: event.currentTarget.value })
                    }
                    data-testid="game-shell-entry-screen"
                    data-shell-path="shell.entryScreenId"
                    data-focused={focusPath === 'shell.entryScreenId'}
                  >
                    {screens.map((screen) => (
                      <option key={screen.id} value={screen.id}>
                        {screen.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    Title
                    <input
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={selectedScreen.title}
                      onChange={(event) =>
                        apply({
                          type: 'set-screen-text',
                          screenId: selectedScreen.id,
                          title: event.currentTarget.value,
                          subtitle: selectedScreen.subtitle,
                        })
                      }
                      data-testid="game-shell-title"
                      data-shell-path={`shell.screens.${selectedScreen.id}.title`}
                      data-focused={focusPath === `shell.screens.${selectedScreen.id}.title`}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Subtitle
                    <input
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={selectedScreen.subtitle}
                      onChange={(event) =>
                        apply({
                          type: 'set-screen-text',
                          screenId: selectedScreen.id,
                          title: selectedScreen.title,
                          subtitle: event.currentTarget.value,
                        })
                      }
                      data-testid="game-shell-subtitle"
                      data-shell-path={`shell.screens.${selectedScreen.id}.subtitle`}
                      data-focused={focusPath === `shell.screens.${selectedScreen.id}.subtitle`}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Layout
                    <select
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={selectedScreen.layout}
                      onChange={(event) =>
                        apply({
                          type: 'set-screen-layout',
                          screenId: selectedScreen.id,
                          layout: event.currentTarget.value as GameShellScreenDefinition['layout'],
                        })
                      }
                      data-testid="game-shell-layout"
                      data-shell-path={`shell.screens.${selectedScreen.id}.layout`}
                      data-focused={focusPath === `shell.screens.${selectedScreen.id}.layout`}
                    >
                      {layouts.map((layout) => (
                        <option key={layout} value={layout}>
                          {layout}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedScreen.enabled}
                      onChange={(event) =>
                        apply({
                          type: 'set-screen-enabled',
                          screenId: selectedScreen.id,
                          enabled: event.currentTarget.checked,
                        })
                      }
                      data-shell-path={`shell.screens.${selectedScreen.id}.enabled`}
                      data-focused={focusPath === `shell.screens.${selectedScreen.id}.enabled`}
                    />
                    Enabled
                  </label>
                </div>

                <div className="grid gap-3 border-t border-border pt-4 md:grid-cols-3">
                  <label className="grid gap-1 text-sm">
                    Asset pack
                    <select
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={selectedPackId}
                      onChange={(event) => setSelectedPackId(event.currentTarget.value)}
                      data-testid="game-shell-pack"
                    >
                      {assetPacks.map((pack) => (
                        <option key={pack.id} value={pack.id}>
                          {pack.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Background
                    <select
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={selectedScreen.backgroundAssetId ?? ''}
                      onChange={(event) =>
                        registerAndAssignAsset('background', event.currentTarget.value)
                      }
                      data-testid="game-shell-background"
                      data-shell-path={`shell.screens.${selectedScreen.id}.backgroundAssetId`}
                      data-focused={
                        focusPath === `shell.screens.${selectedScreen.id}.backgroundAssetId`
                      }
                    >
                      <option value="">No background</option>
                      {backgroundChoices.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.path}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Free font
                    <select
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={selectedScreen.fontAssetId ?? ''}
                      onChange={(event) =>
                        registerAndAssignAsset('font', event.currentTarget.value)
                      }
                      data-testid="game-shell-font"
                      data-shell-path={`shell.screens.${selectedScreen.id}.fontAssetId`}
                      data-focused={focusPath === `shell.screens.${selectedScreen.id}.fontAssetId`}
                    >
                      <option value="">Project token font</option>
                      {fontChoices.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.path}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 border-t border-border pt-4 md:grid-cols-4">
                  <label className="grid gap-1 text-sm">
                    Action label
                    <input
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={actionLabel}
                      onChange={(event) => setActionLabel(event.currentTarget.value)}
                      data-testid="game-shell-action-label"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Action type
                    <select
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={actionType}
                      onChange={(event) =>
                        setActionType(event.currentTarget.value as GameShellActionType)
                      }
                      data-testid="game-shell-action-type"
                    >
                      {GAME_SHELL_ACTION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Target screen
                    <select
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={actionTarget}
                      onChange={(event) => setActionTarget(event.currentTarget.value)}
                      disabled={actionType !== 'navigate'}
                      data-testid="game-shell-action-target"
                    >
                      {screens.map((screen) => (
                        <option key={screen.id} value={screen.id}>
                          {screen.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Shell event
                    <select
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={actionEvent}
                      onChange={(event) =>
                        setActionEvent(event.currentTarget.value as GameShellRegisteredEvent)
                      }
                      disabled={actionType !== 'emit-event'}
                      data-testid="game-shell-action-event"
                    >
                      {GAME_SHELL_REGISTERED_EVENTS.map((eventName) => (
                        <option key={eventName} value={eventName}>
                          {eventName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    className="md:col-span-4"
                    onClick={upsertAction}
                    data-testid="game-shell-add-action"
                  >
                    Add typed action
                  </Button>
                </div>

                <div className="grid gap-2">
                  <h3 className={typography.panelTitle}>Actions</h3>
                  {selectedScreen.actions.map((action) => (
                    <div
                      key={action.id}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-sm',
                        focusClass(
                          `shell.screens.${selectedScreen.id}.actions.${action.id}.targetScreenId`,
                        ),
                      )}
                      data-testid="game-shell-action-row"
                      data-shell-path={`shell.screens.${selectedScreen.id}.actions.${action.id}.targetScreenId`}
                      data-focused={
                        focusPath ===
                        `shell.screens.${selectedScreen.id}.actions.${action.id}.targetScreenId`
                      }
                    >
                      <span>
                        {action.label} · {action.type}
                        {action.targetScreenId === undefined ? '' : ` -> ${action.targetScreenId}`}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          apply({
                            type: 'remove-action',
                            screenId: selectedScreen.id,
                            actionId: action.id,
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <aside className="grid content-start gap-4">
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className={typography.panelTitle}>Design tokens</h2>
              {tokens === undefined ? null : (
                <div className="mt-3 grid gap-2">
                  {(
                    ['fontFamily', 'textColor', 'accentColor', 'panelColor', 'focusColor'] as const
                  ).map((key) => (
                    <label key={key} className="grid gap-1 text-sm">
                      {key}
                      <input
                        className="rounded border border-input bg-input/20 px-2 py-1"
                        value={tokens[key]}
                        onChange={(event) =>
                          apply({
                            type: 'set-design-tokens',
                            tokens: { [key]: event.currentTarget.value },
                          })
                        }
                        data-testid={`game-shell-token-${key}`}
                      />
                    </label>
                  ))}
                  <label className="grid gap-1 text-sm">
                    Spacing
                    <select
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={tokens.spacing}
                      onChange={(event) =>
                        apply({
                          type: 'set-design-tokens',
                          tokens: {
                            spacing: event.currentTarget.value as (typeof spacingTokens)[number],
                          },
                        })
                      }
                    >
                      {spacingTokens.map((token) => (
                        <option key={token} value={token}>
                          {token}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Motion
                    <select
                      className="rounded border border-input bg-input/20 px-2 py-1"
                      value={tokens.motion}
                      onChange={(event) =>
                        apply({
                          type: 'set-design-tokens',
                          tokens: {
                            motion: event.currentTarget.value as (typeof motionTokens)[number],
                          },
                        })
                      }
                    >
                      {motionTokens.map((token) => (
                        <option key={token} value={token}>
                          {token}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </section>

            <section
              className="min-h-64 rounded-lg border border-border p-5"
              style={{
                background: tokens?.panelColor ?? '#111827',
                color: tokens?.textColor ?? '#f8fafc',
                fontFamily: tokens?.fontFamily,
              }}
              data-testid="game-shell-preview"
            >
              <p className="text-xs uppercase tracking-normal opacity-70">{selectedScreen?.kind}</p>
              <h2 className="mt-10 text-3xl font-semibold">{selectedScreen?.title}</h2>
              <p className="mt-2 text-sm opacity-80">{selectedScreen?.subtitle}</p>
              <div className="mt-6 grid gap-2">
                {selectedScreen?.actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="rounded border px-3 py-2 text-left"
                    style={{ borderColor: tokens?.focusColor, color: tokens?.accentColor }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className={typography.panelTitle}>Readiness</h2>
              <ul className="mt-3 grid gap-2 text-sm" data-testid="game-shell-diagnostics">
                {diagnostics.length === 0 ? (
                  <li className="text-muted-foreground">No shell problems detected.</li>
                ) : (
                  diagnostics.map((issue) => (
                    <li
                      key={`${issue.code}:${issue.path}`}
                      className={cn(
                        'rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive',
                        focusClass(issue.path),
                      )}
                      data-shell-path={issue.path}
                      data-focused={focusPath === issue.path}
                    >
                      {issue.message}
                    </li>
                  ))
                )}
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </ScrollArea>
  );
}
