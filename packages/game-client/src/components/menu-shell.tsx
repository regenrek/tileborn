import type { BrandConfig } from '@tileborne/core';
import { Button } from '@tileborne/ui';
import type { GameShellActionDefinition, RuntimeGameShellProjection } from '@tileborne/runtime';
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { MenuSectionRegistration } from '../contributions/menu-registry.js';
import type { MenuEvent, MenuState, SettingsTab } from '../state/menu-machine.js';
import { BootSplash } from './boot-splash.js';
import { ErrorPanel } from './error-panel.js';
import { MainMenu } from './main-menu.js';
import { PauseOverlay } from './pause-overlay.js';
import { ResultsScreen, type MatchResults } from './results-screen.js';
import { SettingsDialog } from './settings-dialog.js';
import { SlotHost } from './slot-host.js';
import type { AudioTabConfig } from './audio-tab.js';
import type { ControlsTabConfig } from './controls-tab.js';

export interface RuntimeLobbyRenderProps {
  readonly matchmaking: boolean;
  readonly onFindMatch: () => void;
  readonly onStartMatch: () => void;
  readonly onBack: () => void;
}

export interface MenuShellProps {
  readonly state: MenuState;
  readonly dispatch: (event: MenuEvent) => void;
  readonly brand: BrandConfig;
  readonly sections: readonly MenuSectionRegistration[];
  readonly results?: MatchResults | undefined;
  readonly bootProgress?: number | undefined;
  readonly onQuit?: (() => void) | undefined;
  /** Controls-tab remap editor wiring (ADR-0024); see {@link SettingsDialog}. */
  readonly controls?: ControlsTabConfig | undefined;
  /** Audio-tab mixer settings wiring; see {@link SettingsDialog}. */
  readonly audio?: AudioTabConfig | undefined;
  readonly renderLobby?: ((props: RuntimeLobbyRenderProps) => ReactNode) | undefined;
  readonly shellProjection?: RuntimeGameShellProjection | undefined;
  readonly shellAssetUrlBase?: string | undefined;
  readonly shellAssetUrlResolver?:
    | ((asset: RuntimeGameShellProjection['assets'][number]) => string | undefined)
    | undefined;
  readonly onProjectionAction?:
    | ((
        screen: RuntimeGameShellProjection['screens'][number],
        action: GameShellActionDefinition,
      ) => void)
    | undefined;
  readonly onProjectionScreenEntered?:
    | ((screen: RuntimeGameShellProjection['screens'][number]) => void)
    | undefined;
}

const screenByStableId = (
  projection: RuntimeGameShellProjection | undefined,
  stableId: RuntimeGameShellProjection['screens'][number]['stableId'],
) => projection?.screens.find((screen) => screen.stableId === stableId && screen.enabled);

const orderedEnabledScreens = (
  projection: RuntimeGameShellProjection | undefined,
): readonly RuntimeGameShellProjection['screens'][number][] => {
  if (projection === undefined) return [];
  const byId = new Map(projection.screens.map((screen) => [screen.id, screen] as const));
  return projection.screenOrder
    .map((screenId) => byId.get(screenId))
    .filter(
      (screen): screen is RuntimeGameShellProjection['screens'][number] =>
        screen !== undefined && screen.enabled,
    );
};

const enabledScreenById = (
  projection: RuntimeGameShellProjection | undefined,
  screenId: string | undefined,
): RuntimeGameShellProjection['screens'][number] | undefined =>
  projection?.screens.find((screen) => screen.id === screenId && screen.enabled);

const projectionEntryScreen = (
  projection: RuntimeGameShellProjection | undefined,
): RuntimeGameShellProjection['screens'][number] | undefined =>
  enabledScreenById(projection, projection?.entryScreenId) ?? orderedEnabledScreens(projection)[0];

const firstAction = (
  screen: RuntimeGameShellProjection['screens'][number] | undefined,
  predicate: (action: GameShellActionDefinition) => boolean,
) => screen?.actions.find(predicate);

const actionLabel = (
  screen: RuntimeGameShellProjection['screens'][number] | undefined,
  fallback: string,
  predicate: (action: GameShellActionDefinition) => boolean,
): string => firstAction(screen, predicate)?.label ?? fallback;

const projectedResults = (
  results: MatchResults | undefined,
  screen: RuntimeGameShellProjection['screens'][number] | undefined,
): MatchResults => {
  const title = results?.title ?? screen?.title;
  return {
    ...(title === undefined ? {} : { title }),
    ...(results?.rows === undefined ? {} : { rows: results.rows }),
  };
};

const actionTestId = (action: GameShellActionDefinition): string =>
  `shell-action-${action.id.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;

const shellAssetUrl = (
  projection: RuntimeGameShellProjection | undefined,
  assetId: string | undefined,
  base: string | undefined,
  resolver?:
    | ((asset: RuntimeGameShellProjection['assets'][number]) => string | undefined)
    | undefined,
): string | undefined => {
  if (assetId === undefined) return undefined;
  const asset = projection?.assets.find((entry) => entry.assetId === assetId);
  if (asset === undefined) return undefined;
  const resolved = resolver?.(asset);
  if (resolved !== undefined) return resolved;
  if (base === undefined) return undefined;
  if (/^(?:[a-z][a-z\d+\-.]*:|\/)/i.test(asset.path)) return asset.path;
  return `${base.replace(/\/+$/, '')}/${asset.path.replace(/^\/+/, '')}`;
};

const shellAssetLabel = (
  projection: RuntimeGameShellProjection | undefined,
  assetId: string | undefined,
): string =>
  projection?.assets.find((entry) => entry.assetId === assetId)?.path ?? assetId ?? 'unknown asset';

const shellFontFamily = (screenId: string, assetId: string): string =>
  `tb-shell-${screenId.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${assetId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;

function ProjectionScreen({
  projection,
  screen,
  shellAssetUrlBase,
  shellAssetUrlResolver,
  sections,
  brand,
  onAction,
  onSlotPlay,
  children,
}: {
  readonly projection: RuntimeGameShellProjection;
  readonly screen: RuntimeGameShellProjection['screens'][number];
  readonly shellAssetUrlBase?: string | undefined;
  readonly shellAssetUrlResolver?:
    | ((asset: RuntimeGameShellProjection['assets'][number]) => string | undefined)
    | undefined;
  readonly sections: readonly MenuSectionRegistration[];
  readonly brand: BrandConfig;
  readonly onAction: (action: GameShellActionDefinition) => void;
  readonly onSlotPlay: () => void;
  readonly children?: ReactNode | undefined;
}): ReactElement {
  const background = shellAssetUrl(
    projection,
    screen.backgroundAssetId,
    shellAssetUrlBase,
    shellAssetUrlResolver,
  );
  const font = shellAssetUrl(
    projection,
    screen.fontAssetId,
    shellAssetUrlBase,
    shellAssetUrlResolver,
  );
  const fontFamily = useMemo(
    () =>
      screen.fontAssetId === undefined ? undefined : shellFontFamily(screen.id, screen.fontAssetId),
    [screen.fontAssetId, screen.id],
  );
  const [backgroundError, setBackgroundError] = useState<string | undefined>(undefined);
  const [fontError, setFontError] = useState<string | undefined>(undefined);
  useEffect(() => {
    setBackgroundError(undefined);
    if (screen.backgroundAssetId === undefined) return;
    if (background === undefined) {
      setBackgroundError(
        `Background asset is unavailable: ${shellAssetLabel(projection, screen.backgroundAssetId)}.`,
      );
      return;
    }
    const image = new Image();
    image.onload = () => setBackgroundError(undefined);
    image.onerror = () =>
      setBackgroundError(
        `Background asset failed to load: ${shellAssetLabel(projection, screen.backgroundAssetId)}.`,
      );
    image.src = background;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [background, projection, screen.backgroundAssetId]);
  useEffect(() => {
    setFontError(undefined);
    if (screen.fontAssetId === undefined) return;
    if (font === undefined || fontFamily === undefined) {
      setFontError(
        `Font asset is unavailable: ${shellAssetLabel(projection, screen.fontAssetId)}.`,
      );
      return;
    }
    if (typeof FontFace === 'undefined' || document.fonts === undefined) {
      setFontError(
        `Font asset cannot be loaded in this environment: ${shellAssetLabel(projection, screen.fontAssetId)}.`,
      );
      return;
    }
    const face = new FontFace(fontFamily, `url("${font}")`);
    let cancelled = false;
    void face.load().then(
      (loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        setFontError(undefined);
      },
      () => {
        if (!cancelled) {
          setFontError(
            `Font asset failed to load: ${shellAssetLabel(projection, screen.fontAssetId)}.`,
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [font, fontFamily, projection, screen.fontAssetId]);
  const style = {
    ...(background === undefined
      ? {}
      : {
          backgroundImage: `linear-gradient(rgba(11, 18, 32, 0.68), rgba(11, 18, 32, 0.68)), url("${background}")`,
        }),
  } as CSSProperties;
  const panelStyle = {
    fontFamily: fontError === undefined ? fontFamily : undefined,
  } as CSSProperties;
  const diagnostics = [
    backgroundError,
    fontError,
    ...projection.diagnostics.map((entry) => entry.message),
  ].filter((message): message is string => message !== undefined);
  return (
    <div
      className={`tb-scrim tb-shell-screen tb-shell-layout-${screen.layout}`}
      data-testid={`shell-screen-${screen.stableId}`}
      data-shell-screen-id={screen.id}
      data-shell-layout={screen.layout}
      style={style}
    >
      <div className="tb-panel" aria-label={screen.title} style={panelStyle}>
        <h1 className="tb-title">{screen.title}</h1>
        {screen.subtitle ? <p className="tb-tagline">{screen.subtitle}</p> : null}
        <div className="tb-actions">
          {screen.actions.map((action) => (
            <Button
              key={action.id}
              type="button"
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
                onAction(action);
              }}
              data-testid={actionTestId(action)}
            >
              {action.label}
            </Button>
          ))}
        </div>
        {diagnostics.length > 0 ? (
          <div role="alert" className="tb-tagline" data-testid="shell-asset-diagnostics">
            {diagnostics.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        ) : null}
        {children}
        {screen.stableId === 'main-menu' ? (
          <>
            <SlotHost
              slot="main.primaryActions"
              sections={sections}
              onPlay={onSlotPlay}
              onBack={() => undefined}
              title={brand.title}
            />
            <SlotHost
              slot="main.tabs"
              sections={sections}
              onPlay={onSlotPlay}
              onBack={() => undefined}
              title={brand.title}
            />
            <SlotHost
              slot="main.secondaryActions"
              sections={sections}
              onPlay={onSlotPlay}
              onBack={() => undefined}
              title={brand.title}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function ShellScreenUnavailable({ message }: { readonly message: string }): ReactElement {
  return (
    <div className="tb-scrim">
      <div className="tb-panel tb-error" role="alert" data-testid="shell-screen-unavailable">
        <h2 className="tb-title">Shell screen unavailable</h2>
        <p className="tb-tagline">{message}</p>
      </div>
    </div>
  );
}

function CreditsView({ brand, onBack }: { brand: BrandConfig; onBack: () => void }): ReactElement {
  return (
    <div className="tb-scrim">
      <div className="tb-panel" role="dialog" aria-label="Credits" data-testid="credits-view">
        <h2 className="tb-title">About {brand.title}</h2>
        <p className="tb-tagline">
          Built on the Tileborne runtime. This is a brand-neutral game client template.
        </p>
        <div className="tb-actions">
          <Button variant="outline" onClick={onBack} data-testid="credits-back">
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the correct menu surface for the current state. The Pixi canvas is
 * rendered separately (underneath) by `RuntimeRoot`; this layer is the React
 * chrome (ADR-0022 boundary: React owns chrome, Pixi owns rendering).
 */
export function MenuShell({
  state,
  dispatch,
  brand,
  sections,
  results,
  bootProgress,
  onQuit,
  controls,
  audio,
  renderLobby,
  shellProjection,
  shellAssetUrlBase,
  shellAssetUrlResolver,
  onProjectionAction,
  onProjectionScreenEntered,
}: MenuShellProps): ReactElement | null {
  const selectTab = (tab: SettingsTab) => dispatch({ type: 'SET_SETTINGS_TAB', tab });
  const titleScreen = screenByStableId(shellProjection, 'title');
  const mainScreen = screenByStableId(shellProjection, 'main-menu');
  const loadingScreen = screenByStableId(shellProjection, 'loading');
  const pauseScreen = screenByStableId(shellProjection, 'pause');
  const settingsScreen = screenByStableId(shellProjection, 'settings');
  const resultsScreen = screenByStableId(shellProjection, 'results');
  const activeProjectionScreen =
    enabledScreenById(shellProjection, state.shellScreenId) ??
    projectionEntryScreen(shellProjection);

  useEffect(() => {
    if (state.phase !== 'menu') return;
    const entry = projectionEntryScreen(shellProjection)?.id;
    const activeExists = enabledScreenById(shellProjection, state.shellScreenId);
    if (shellProjection === undefined) {
      if (state.shellScreenId !== undefined) {
        dispatch({ type: 'SET_SHELL_ENTRY', screenId: undefined });
      }
      return;
    }
    if (activeExists === undefined && state.shellScreenId !== entry) {
      dispatch({ type: 'SET_SHELL_ENTRY', screenId: entry });
    }
  }, [dispatch, shellProjection, state.phase, state.shellScreenId]);

  useEffect(() => {
    if (shellProjection === undefined) return;
    if (state.phase === 'menu') {
      if (state.screen === 'settings') {
        if (state.shellScreenId !== settingsScreen?.id) {
          dispatch({ type: 'SET_SHELL_SCREEN', screenId: settingsScreen?.id });
        }
        return;
      }
      if (state.screen === 'main') {
        const activeScreen = enabledScreenById(shellProjection, state.shellScreenId);
        if (activeScreen?.stableId === 'settings') {
          dispatch({
            type: 'SET_SHELL_ENTRY',
            screenId: projectionEntryScreen(shellProjection)?.id,
          });
        }
      }
      return;
    }
    if (state.phase === 'lobby' || state.phase === 'matchmaking') {
      if (loadingScreen !== undefined && state.shellScreenId !== loadingScreen.id) {
        dispatch({ type: 'SET_SHELL_SCREEN', screenId: loadingScreen?.id });
      }
      return;
    }
    if (state.phase === 'in-match' && state.paused) {
      if (pauseScreen !== undefined && state.shellScreenId !== pauseScreen.id) {
        dispatch({ type: 'SET_SHELL_SCREEN', screenId: pauseScreen?.id });
      }
      return;
    }
    if (state.phase === 'results') {
      if (resultsScreen !== undefined && state.shellScreenId !== resultsScreen.id) {
        dispatch({ type: 'SET_SHELL_SCREEN', screenId: resultsScreen?.id });
      }
    }
  }, [
    dispatch,
    loadingScreen?.id,
    pauseScreen?.id,
    resultsScreen?.id,
    settingsScreen?.id,
    shellProjection,
    state.phase,
    state.paused,
    state.screen,
    state.shellScreenId,
  ]);

  useEffect(() => {
    if (activeProjectionScreen !== undefined) {
      onProjectionScreenEntered?.(activeProjectionScreen);
    }
  }, [activeProjectionScreen, onProjectionScreenEntered]);

  const runProjectionAction = (
    screen: RuntimeGameShellProjection['screens'][number],
    action: GameShellActionDefinition,
  ) => {
    switch (action.type) {
      case 'navigate': {
        const target = enabledScreenById(shellProjection, action.targetScreenId);
        if (target !== undefined) {
          if (target.stableId === 'settings') {
            dispatch({
              type: 'NAVIGATE_SHELL_SCREEN',
              screenId: target.id,
              menuScreen: 'settings',
            });
          } else if (target.stableId === 'main-menu' || target.stableId === 'title') {
            if (
              state.phase === 'in-match' ||
              state.phase === 'results' ||
              state.phase === 'lobby' ||
              state.phase === 'matchmaking'
            ) {
              dispatch({ type: 'TO_MENU' });
              dispatch({ type: 'SET_SHELL_SCREEN', screenId: target.id });
            } else if (state.screen !== 'main') {
              dispatch({
                type: 'NAVIGATE_SHELL_SCREEN',
                screenId: target.id,
                menuScreen: 'main',
                replaceHistory: true,
              });
            } else {
              dispatch({ type: 'SET_SHELL_SCREEN', screenId: target.id, pushHistory: true });
            }
          } else {
            dispatch({ type: 'NAVIGATE_SHELL_SCREEN', screenId: target.id, menuScreen: 'main' });
          }
        }
        onProjectionAction?.(screen, action);
        return;
      }
      case 'open-settings':
        if (settingsScreen !== undefined) {
          dispatch({
            type: 'NAVIGATE_SHELL_SCREEN',
            screenId: settingsScreen.id,
            menuScreen: 'settings',
          });
        }
        onProjectionAction?.(screen, action);
        return;
      case 'start-single-player':
      case 'start-multiplayer':
        dispatch({ type: 'PLAY' });
        queueMicrotask(() => onProjectionAction?.(screen, action));
        return;
      case 'resume':
        dispatch({ type: 'RESUME' });
        onProjectionAction?.(screen, action);
        return;
      case 'retry':
        dispatch({ type: 'PLAY_AGAIN' });
        onProjectionAction?.(screen, action);
        return;
      case 'exit':
        dispatch({ type: 'TO_MENU' });
        onProjectionAction?.(screen, action);
        return;
      case 'emit-event':
        onProjectionAction?.(screen, action);
        return;
    }
  };

  switch (state.phase) {
    case 'boot':
      return <BootSplash brand={brand} progress={bootProgress} />;

    case 'error':
      return state.error ? (
        <ErrorPanel error={state.error} onDismiss={() => dispatch({ type: 'DISMISS_ERROR' })} />
      ) : null;

    case 'menu': {
      if (shellProjection !== undefined && state.screen !== 'credits') {
        if (activeProjectionScreen === undefined) {
          return (
            <ShellScreenUnavailable message="No enabled authored shell screen can be rendered." />
          );
        }
        if (activeProjectionScreen.stableId === 'settings') {
          return (
            <ProjectionScreen
              projection={shellProjection}
              screen={activeProjectionScreen}
              shellAssetUrlBase={shellAssetUrlBase}
              shellAssetUrlResolver={shellAssetUrlResolver}
              sections={sections}
              brand={brand}
              onAction={(action) => runProjectionAction(activeProjectionScreen, action)}
              onSlotPlay={() => dispatch({ type: 'PLAY' })}
            >
              <div data-testid="settings-dialog" role="dialog" aria-label="Settings">
                <SettingsDialog
                  brand={brand}
                  sections={sections}
                  activeTab={state.settingsTab}
                  onSelectTab={selectTab}
                  onBack={() => dispatch({ type: 'BACK' })}
                  chrome={false}
                  showBackAction={false}
                  {...(controls ? { controls } : {})}
                  {...(audio ? { audio } : {})}
                />
              </div>
            </ProjectionScreen>
          );
        }
        return (
          <ProjectionScreen
            projection={shellProjection}
            screen={activeProjectionScreen}
            shellAssetUrlBase={shellAssetUrlBase}
            shellAssetUrlResolver={shellAssetUrlResolver}
            sections={sections}
            brand={brand}
            onAction={(action) => runProjectionAction(activeProjectionScreen, action)}
            onSlotPlay={() => dispatch({ type: 'PLAY' })}
          />
        );
      }
      if (state.screen === 'settings') {
        return (
          <SettingsDialog
            brand={brand}
            sections={sections}
            title={settingsScreen?.title}
            subtitle={settingsScreen?.subtitle}
            activeTab={state.settingsTab}
            onSelectTab={selectTab}
            onBack={() => dispatch({ type: 'BACK' })}
            {...(controls ? { controls } : {})}
            {...(audio ? { audio } : {})}
          />
        );
      }
      if (state.screen === 'credits') {
        return <CreditsView brand={brand} onBack={() => dispatch({ type: 'BACK' })} />;
      }
      return (
        <MainMenu
          brand={brand}
          sections={sections}
          title={mainScreen?.title ?? titleScreen?.title}
          subtitle={mainScreen?.subtitle ?? titleScreen?.subtitle}
          playLabel={actionLabel(
            mainScreen,
            brand.lobbyCopy.cta || 'Play',
            (action) =>
              action.type === 'start-single-player' ||
              action.type === 'start-multiplayer' ||
              action.type === 'navigate',
          )}
          settingsLabel={actionLabel(
            mainScreen,
            'Settings',
            (action) => action.type === 'open-settings' || action.targetScreenId === 'settings',
          )}
          onPlay={() => dispatch({ type: 'PLAY' })}
          onOpenSettings={() => dispatch({ type: 'OPEN_SETTINGS' })}
          onOpenCredits={() => dispatch({ type: 'OPEN_CREDITS' })}
          onQuit={onQuit}
        />
      );
    }

    case 'lobby':
    case 'matchmaking': {
      const matchmaking = state.phase === 'matchmaking';
      if (shellProjection !== undefined) {
        if (loadingScreen === undefined) {
          return (
            <ShellScreenUnavailable message="The authored loading screen is disabled or missing." />
          );
        }
        return (
          <ProjectionScreen
            projection={shellProjection}
            screen={loadingScreen}
            shellAssetUrlBase={shellAssetUrlBase}
            shellAssetUrlResolver={shellAssetUrlResolver}
            sections={sections}
            brand={brand}
            onAction={(action) => runProjectionAction(loadingScreen, action)}
            onSlotPlay={() => dispatch({ type: 'PLAY' })}
          >
            {renderLobby?.({
              matchmaking,
              onFindMatch: () => dispatch({ type: 'MATCHMAKING_START' }),
              onStartMatch: () => dispatch({ type: 'MATCH_START' }),
              onBack: () => dispatch({ type: 'BACK' }),
            })}
          </ProjectionScreen>
        );
      }
      if (renderLobby) {
        return (
          <>
            {renderLobby({
              matchmaking,
              onFindMatch: () => dispatch({ type: 'MATCHMAKING_START' }),
              onStartMatch: () => dispatch({ type: 'MATCH_START' }),
              onBack: () => dispatch({ type: 'BACK' }),
            })}
          </>
        );
      }
      return (
        <div className="tb-scrim">
          <div
            className="tb-panel"
            aria-label={matchmaking ? (loadingScreen?.title ?? 'Match loading') : 'Lobby'}
            data-testid="lobby"
          >
            <h2 className="tb-title">
              {matchmaking ? (loadingScreen?.title ?? 'Finding a match…') : 'Lobby'}
            </h2>
            <p className="tb-tagline" role={matchmaking ? 'status' : undefined} aria-live="polite">
              {matchmaking
                ? (loadingScreen?.subtitle ?? 'Matchmaking in progress.')
                : 'Choose your loadout and ready up.'}
            </p>
            <div className="tb-actions">
              {matchmaking ? null : (
                <Button
                  onClick={() => dispatch({ type: 'MATCHMAKING_START' })}
                  data-testid="find-match"
                >
                  Find match
                </Button>
              )}
              <Button onClick={() => dispatch({ type: 'MATCH_START' })} data-testid="start-match">
                Start match
              </Button>
              <Button
                variant="outline"
                onClick={() => dispatch({ type: 'BACK' })}
                data-testid="lobby-back"
              >
                Back
              </Button>
            </div>
          </div>
        </div>
      );
    }

    case 'in-match':
      return state.paused ? (
        shellProjection !== undefined ? (
          pauseScreen === undefined ? (
            <ShellScreenUnavailable message="The authored pause screen is disabled or missing." />
          ) : (
            <ProjectionScreen
              projection={shellProjection}
              screen={pauseScreen}
              shellAssetUrlBase={shellAssetUrlBase}
              shellAssetUrlResolver={shellAssetUrlResolver}
              sections={sections}
              brand={brand}
              onAction={(action) => runProjectionAction(pauseScreen, action)}
              onSlotPlay={() => dispatch({ type: 'PLAY' })}
            />
          )
        ) : (
          <PauseOverlay
            brand={brand}
            sections={sections}
            title={pauseScreen?.title}
            subtitle={pauseScreen?.subtitle}
            resumeLabel={actionLabel(pauseScreen, 'Resume', (action) => action.type === 'resume')}
            settingsLabel={actionLabel(
              pauseScreen,
              'Settings',
              (action) => action.type === 'open-settings' || action.targetScreenId === 'settings',
            )}
            quitLabel={actionLabel(
              pauseScreen,
              'Quit to menu',
              (action) => action.targetScreenId === 'main-menu' || action.type === 'exit',
            )}
            onResume={() => dispatch({ type: 'RESUME' })}
            onOpenSettings={() => dispatch({ type: 'OPEN_SETTINGS' })}
            onQuitToMenu={() => dispatch({ type: 'TO_MENU' })}
          />
        )
      ) : (
        // In-match: HUD is contributed; the chassis only shows a minimal stub +
        // ends the match. Real HUD widgets mount via hudWidgets contributions.
        <div className="tb-hud-stub" role="status" aria-live="polite" data-testid="in-match">
          <span>In match — press Esc to pause</span>
          <div className="tb-actions" style={{ marginTop: '0.5rem' }}>
            <Button
              size="sm"
              className="tb-shell-interactive-control"
              onClick={() => dispatch({ type: 'MATCH_END' })}
              data-testid="end-match"
            >
              End match
            </Button>
          </div>
        </div>
      );

    case 'results':
      if (shellProjection !== undefined) {
        if (resultsScreen === undefined) {
          return (
            <ShellScreenUnavailable message="The authored results screen is disabled or missing." />
          );
        }
        return (
          <ProjectionScreen
            projection={shellProjection}
            screen={resultsScreen}
            shellAssetUrlBase={shellAssetUrlBase}
            shellAssetUrlResolver={shellAssetUrlResolver}
            sections={sections}
            brand={brand}
            onAction={(action) => runProjectionAction(resultsScreen, action)}
            onSlotPlay={() => dispatch({ type: 'PLAY' })}
          >
            <div data-testid="results-screen" role="dialog" aria-label="Match results">
              <ResultsScreen
                brand={brand}
                sections={sections}
                results={projectedResults(results, resultsScreen)}
                subtitle={resultsScreen.subtitle}
                onPlayAgain={() => dispatch({ type: 'PLAY_AGAIN' })}
                onBackToMenu={() => dispatch({ type: 'TO_MENU' })}
                chrome={false}
                showDefaultActions={false}
              />
            </div>
          </ProjectionScreen>
        );
      }
      return (
        <ResultsScreen
          brand={brand}
          sections={sections}
          results={projectedResults(results, resultsScreen)}
          subtitle={resultsScreen?.subtitle}
          playAgainLabel={actionLabel(
            resultsScreen,
            'Play again',
            (action) => action.type === 'retry',
          )}
          backLabel={actionLabel(
            resultsScreen,
            'Back to menu',
            (action) => action.targetScreenId === 'main-menu',
          )}
          onPlayAgain={() => dispatch({ type: 'PLAY_AGAIN' })}
          onBackToMenu={() => dispatch({ type: 'TO_MENU' })}
        />
      );

    default:
      return null;
  }
}
