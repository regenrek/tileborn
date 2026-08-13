import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_HUD_WIDGETS, HudLayout } from '@tileborne/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  applyGameShellAuthoringCommand,
  buildRuntimeGameShellProjection,
  decodeGameShellDefaultsDefinition,
  defaultProjectGameShellState,
  gameShellStateFromDefaults,
} from '@tileborne/runtime';

import type { MenuSectionRegistration } from '../contributions/menu-registry.js';
import { initialMenuState } from '../state/menu-machine.js';
import type { RuntimeShellBehaviorBridge } from '../shell-behavior-bridge.js';
import { RuntimeRoot } from './runtime-root.js';

const entityId = (id: string) => id as never;
const itemId = (id: string) => id as never;
const pluginBattleRoyaleManifestPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../plugin-battle-royale/tileborne-plugin.json',
);
const menuCssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../styles/menu.css');

const battleRoyaleFixtureProjection = async () => {
  const raw = JSON.parse(await readFile(pluginBattleRoyaleManifestPath, 'utf8')) as {
    readonly id?: unknown;
    readonly contributes?: {
      readonly runtime?: {
        readonly shellDefaults?: readonly { readonly data?: unknown }[];
      };
    };
  };
  const pluginId = typeof raw.id === 'string' ? raw.id : 'tileborne.battle-royale';
  const defaults = decodeGameShellDefaultsDefinition(
    pluginId,
    raw.contributes?.runtime?.shellDefaults?.[0]?.data,
  );
  if (defaults === undefined) {
    throw new Error('Battle Royale shell defaults fixture did not decode');
  }
  return buildRuntimeGameShellProjection(gameShellStateFromDefaults(defaults));
};

describe('RuntimeRoot', () => {
  it('boots into the main menu then walks play -> match -> results -> menu', async () => {
    const user = userEvent.setup();
    render(<RuntimeRoot onQuit={() => undefined} />);

    // boot splash -> main menu
    expect(screen.getByTestId('boot-splash')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
    expect(screen.getByText('Tileborne Game')).toBeInTheDocument();

    await user.click(screen.getByTestId('play-button'));
    expect(screen.getByTestId('lobby')).toBeInTheDocument();

    await user.click(screen.getByTestId('start-match'));
    expect(screen.getByTestId('in-match')).toBeInTheDocument();

    await user.click(screen.getByTestId('end-match'));
    expect(screen.getByTestId('results-screen')).toBeInTheDocument();

    await user.click(screen.getByTestId('results-back'));
    expect(screen.getByTestId('main-menu')).toBeInTheDocument();
  });

  it('makes the unpaused in-match shell pointer-transparent except controls', async () => {
    const user = userEvent.setup();
    render(<RuntimeRoot initialState={{ ...initialMenuState, phase: 'in-match' }} />);

    const root = screen.getByRole('application');
    expect(root).toHaveAttribute('data-phase', 'in-match');
    expect(root).toHaveAttribute('data-paused', 'false');
    const crosshair = screen.getByTestId('runtime-crosshair');
    expect(crosshair).toBeInTheDocument();
    expect(crosshair).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('end-match')).toHaveClass('tb-shell-interactive-control');

    const menuCss = await readFile(menuCssPath, 'utf8');
    expect(menuCss).toContain(".tb-root[data-phase='in-match'][data-paused='false']");
    expect(menuCss).toContain('pointer-events: none;');
    expect(menuCss).toContain('.tb-shell-interactive-control');
    expect(menuCss).toContain('pointer-events: auto;');
    expect(menuCss).toContain('.tb-crosshair');
    expect(menuCss).toContain('transform: translate(-50%, -50%);');

    await user.click(screen.getByTestId('end-match'));
    expect(screen.getByTestId('results-screen')).toBeInTheDocument();
  });

  it('hides the centered crosshair when the match is paused', () => {
    render(<RuntimeRoot initialState={{ ...initialMenuState, phase: 'in-match', paused: true }} />);

    expect(screen.queryByTestId('runtime-crosshair')).toBeNull();
  });

  it('keeps deterministic keyboard focus and Back policy across shell screens', async () => {
    const user = userEvent.setup();
    render(<RuntimeRoot />);
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('play-button')).toHaveFocus());

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByTestId('settings-button')).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('settings-dialog')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('settings-tab-graphics')).toHaveFocus());

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('settings-tab-audio')).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Backspace' });
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
  });

  it('focuses the active shell controls when a gamepad connects', async () => {
    render(<RuntimeRoot />);
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
    screen.getByTestId('settings-button').focus();
    expect(screen.getByTestId('settings-button')).toHaveFocus();

    const event = new Event('gamepadconnected');
    Object.defineProperty(event, 'gamepad', {
      value: { index: 0 },
    });
    window.dispatchEvent(event);

    await waitFor(() => expect(screen.getByTestId('settings-button')).toHaveFocus());
    expect(screen.getByRole('application')).toHaveAttribute('data-input-device', 'gamepad');
  });

  it('polls gamepads for movement, activation, back, debounce, and disconnect cleanup', async () => {
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const makeButton = (pressed = false) => ({ pressed, touched: pressed, value: pressed ? 1 : 0 });
    const buttons = Array.from({ length: 17 }, () => makeButton());
    const pad = { buttons, axes: [0, 0, 0, 0], connected: true, index: 0 } as unknown as Gamepad;
    const originalGetGamepads = navigator.getGamepads;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: vi.fn(() => [pad]),
    });
    let unmount: (() => void) | undefined;
    const step = (at: number): void => {
      now = at;
      const callback = frame;
      frame = undefined;
      callback?.(at);
    };

    try {
      ({ unmount } = render(<RuntimeRoot />));
      await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
      screen.getByTestId('play-button').focus();
      expect(screen.getByTestId('play-button')).toHaveFocus();

      buttons[13] = makeButton(true);
      step(0);
      expect(screen.getByTestId('settings-button')).toHaveFocus();

      step(50);
      expect(screen.getByTestId('settings-button')).toHaveFocus();

      buttons[13] = makeButton(false);
      buttons[0] = makeButton(true);
      step(250);
      await waitFor(() => expect(screen.getByTestId('settings-dialog')).toBeInTheDocument());

      buttons[0] = makeButton(false);
      buttons[1] = makeButton(true);
      step(500);
      await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());

      const connect = new Event('gamepadconnected');
      Object.defineProperty(connect, 'gamepad', { value: { index: 0 } });
      window.dispatchEvent(connect);
      expect(screen.getByRole('application')).toHaveAttribute('data-input-device', 'gamepad');

      const disconnect = new Event('gamepaddisconnected');
      Object.defineProperty(disconnect, 'gamepad', { value: { index: 0 } });
      window.dispatchEvent(disconnect);
      expect(screen.getByRole('application')).not.toHaveAttribute('data-input-device');
    } finally {
      unmount?.();
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: originalGetGamepads,
      });
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('does not move gamepad focus out of editable fields', async () => {
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    const buttons = Array.from({ length: 17 }, (_, index) => ({
      pressed: index === 13,
      touched: index === 13,
      value: index === 13 ? 1 : 0,
    }));
    const originalGetGamepads = navigator.getGamepads;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: vi.fn(() => [{ buttons, axes: [0, 0, 0, 0], connected: true, index: 0 }]),
    });
    let unmount: (() => void) | undefined;

    try {
      ({ unmount } = render(
        <RuntimeRoot
          initialState={{ ...initialMenuState, phase: 'lobby' }}
          renderLobby={() => (
            <div data-testid="editable-lobby">
              <input aria-label="Player name" />
              <button type="button">Ready</button>
            </div>
          )}
        />,
      ));
      const input = screen.getByLabelText('Player name');
      input.focus();
      frame?.(0);
      expect(input).toHaveFocus();
    } finally {
      unmount?.();
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: originalGetGamepads,
      });
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it('renders authored shell projection text through the runtime shell owner', async () => {
    const user = userEvent.setup();
    const authored = applyGameShellAuthoringCommand(defaultProjectGameShellState(), {
      type: 'set-screen-text',
      screenId: 'main-menu',
      title: 'Authored Arena',
      subtitle: 'Projected from the project shell',
    });

    render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellProjection={buildRuntimeGameShellProjection(authored)}
      />,
    );

    expect(screen.getByTestId('shell-screen-title')).toBeInTheDocument();
    await user.click(screen.getByTestId('shell-action-title-start'));
    expect(screen.getByRole('heading', { name: 'Authored Arena' })).toBeInTheDocument();
    expect(screen.getByText('Projected from the project shell')).toBeInTheDocument();
  });

  it('keeps Electron fixture title-start navigation reducer-owned while action bridge responses still apply', async () => {
    const user = userEvent.setup();
    const projection = await battleRoyaleFixtureProjection();
    const events: Parameters<RuntimeShellBehaviorBridge['emitShellEvent']>[0][] = [];
    const bridge: RuntimeShellBehaviorBridge = {
      shellNavigationRequests: [],
      emitShellEvent: (event) => events.push(event),
    };

    const { rerender } = render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellProjection={projection}
        shellBridge={bridge}
      />,
    );

    expect(screen.getByRole('button', { name: 'Deploy' })).toBeInTheDocument();
    await user.click(screen.getByTestId('shell-action-title-start'));
    expect(screen.getByTestId('shell-screen-main-menu')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Squad Lobby' })).toBeInTheDocument();
    expect(events.some((event) => event.actionId === 'title.start')).toBe(false);

    rerender(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellProjection={projection}
        shellBridge={{
          ...bridge,
          shellNavigationRequests: [
            {
              epoch: 'electron-fixture',
              sequence: 1,
              sourceEvent: { event: 'shell.menu.entered', screenId: 'main-menu' },
              request: { type: 'navigate', targetScreenId: 'settings' },
            },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('shell-screen-main-menu')).toBeInTheDocument();

    rerender(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellProjection={projection}
        shellBridge={{
          ...bridge,
          shellNavigationRequests: [
            {
              epoch: 'electron-fixture',
              sequence: 2,
              sourceEvent: {
                event: 'shell.action.invoked',
                screenId: 'main-menu',
                actionId: 'menu.settings',
              },
              request: { type: 'navigate', targetScreenId: 'settings' },
            },
          ],
        }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('settings-dialog')).toBeInTheDocument());
  });

  it('executes authored projection entry, layout, assets, action order, and events', async () => {
    const user = userEvent.setup();
    let state = defaultProjectGameShellState();
    state = applyGameShellAuthoringCommand(state, {
      type: 'register-asset',
      asset: {
        assetId: 'asset:bg',
        packId: 'pack:shell',
        packVersion: '1.0.0',
        path: 'assets/shell/gate.png',
        mime: 'image/png',
        kind: 'background',
      },
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-text',
      screenId: 'title',
      title: 'Gate Screen',
      subtitle: 'Authored entry',
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-layout',
      screenId: 'title',
      layout: 'split',
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-asset',
      screenId: 'title',
      slot: 'background',
      assetId: 'asset:bg',
    });
    state = applyGameShellAuthoringCommand(
      applyGameShellAuthoringCommand(state, {
        type: 'remove-action',
        screenId: 'title',
        actionId: 'title.start',
      }),
      { type: 'remove-action', screenId: 'title', actionId: 'title.settings' },
    );
    state = applyGameShellAuthoringCommand(state, {
      type: 'upsert-action',
      screenId: 'title',
      action: {
        id: 'title.signal',
        label: 'Signal',
        type: 'emit-event',
        event: 'shell.title.entered',
      },
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'upsert-action',
      screenId: 'title',
      action: {
        id: 'title.continue',
        label: 'Continue',
        type: 'navigate',
        targetScreenId: 'main-menu',
      },
    });
    const events: Parameters<RuntimeShellBehaviorBridge['emitShellEvent']>[0][] = [];

    render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellProjection={buildRuntimeGameShellProjection(state)}
        shellAssetUrlBase="maps/map-fixture"
        shellBridge={{ emitShellEvent: (event) => events.push(event) }}
      />,
    );

    const title = screen.getByTestId('shell-screen-title');
    expect(title).toHaveAttribute('data-shell-layout', 'split');
    expect(title.getAttribute('style')).toContain('maps/map-fixture/assets/shell/gate.png');
    expect(screen.getByRole('heading', { name: 'Gate Screen' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Signal',
      'Continue',
    ]);

    await user.click(screen.getByTestId('shell-action-title-signal'));
    expect(events).toEqual(
      expect.arrayContaining([
        { event: 'shell.action.invoked', screenId: 'title', actionId: 'title.signal' },
        { event: 'shell.title.entered', screenId: 'title', actionId: 'title.signal' },
      ]),
    );

    await user.click(screen.getByTestId('shell-action-title-continue'));
    expect(screen.getByTestId('shell-screen-main-menu')).toBeInTheDocument();
    expect(events.some((event) => event.actionId === 'title.continue')).toBe(false);
  });

  it('uses reducer-owned authored shell history for settings Back and authored action order', async () => {
    const user = userEvent.setup();
    let state = defaultProjectGameShellState();
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-order',
      screenOrder: ['settings', 'title', 'main-menu', 'loading', 'pause', 'results'],
    });
    state = applyGameShellAuthoringCommand(
      applyGameShellAuthoringCommand(state, {
        type: 'remove-action',
        screenId: 'settings',
        actionId: 'settings.back',
      }),
      {
        type: 'upsert-action',
        screenId: 'settings',
        action: {
          id: 'settings.to-loading',
          label: 'Loading screen',
          type: 'navigate',
          targetScreenId: 'loading',
        },
      },
    );
    state = applyGameShellAuthoringCommand(state, {
      type: 'upsert-action',
      screenId: 'settings',
      action: { id: 'settings.back', label: 'Back', type: 'navigate', targetScreenId: 'main-menu' },
    });

    render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellProjection={buildRuntimeGameShellProjection(state)}
      />,
    );

    await user.click(screen.getByTestId('shell-action-title-settings'));
    expect(screen.getByTestId('settings-dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Loading screen',
      'Back',
    ]);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Graphics',
      'Audio',
      'Controls',
      'Accessibility',
    ]);

    await user.click(screen.getByTestId('shell-action-settings-back'));
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).toBeInTheDocument());
    expect(screen.queryByTestId('shell-screen-title')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('shell-action-menu-settings'));
    expect(screen.getByTestId('settings-dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('shell-action-settings-to-loading'));
    await waitFor(() => expect(screen.getByTestId('shell-screen-loading')).toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('settings-dialog')).toBeInTheDocument());
  });

  it('renders authored disabled lifecycle screens as accessible unavailable diagnostics', () => {
    let state = defaultProjectGameShellState();
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-enabled',
      screenId: 'loading',
      enabled: false,
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-enabled',
      screenId: 'pause',
      enabled: false,
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-enabled',
      screenId: 'results',
      enabled: false,
    });
    const projection = buildRuntimeGameShellProjection(state);
    const first = render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'lobby' }}
        shellProjection={projection}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('authored loading screen');
    first.unmount();

    const second = render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'in-match', paused: true }}
        shellProjection={projection}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('authored pause screen');
    second.unmount();

    render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'results' }}
        shellProjection={projection}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('authored results screen');
  });

  it('honors authored results action removal and ordering instead of fixed retry/menu buttons', () => {
    let state = defaultProjectGameShellState();
    state = applyGameShellAuthoringCommand(state, {
      type: 'remove-action',
      screenId: 'results',
      actionId: 'results.retry',
    });
    state = applyGameShellAuthoringCommand(
      applyGameShellAuthoringCommand(state, {
        type: 'remove-action',
        screenId: 'results',
        actionId: 'results.menu',
      }),
      {
        type: 'upsert-action',
        screenId: 'results',
        action: {
          id: 'results.only-menu',
          label: 'Only menu',
          type: 'navigate',
          targetScreenId: 'main-menu',
        },
      },
    );

    render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'results' }}
        shellProjection={buildRuntimeGameShellProjection(state)}
        results={{ rows: [{ rank: 1, name: 'Ada', score: 7 }] }}
      />,
    );

    expect(screen.getByTestId('results-screen')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Only menu',
    ]);
    expect(screen.queryByTestId('play-again')).toBeNull();
    expect(screen.queryByTestId('results-back')).toBeNull();
  });

  it('loads authored shell assets fail-soft with accessible diagnostics', async () => {
    const originalImage = window.Image;
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    Object.defineProperty(window, 'Image', { configurable: true, value: FailingImage });
    let state = defaultProjectGameShellState();
    state = applyGameShellAuthoringCommand(state, {
      type: 'register-asset',
      asset: {
        assetId: 'asset:bg-missing',
        packId: 'pack:shell',
        packVersion: '1.0.0',
        path: 'assets/shell/missing.png',
        mime: 'image/png',
        kind: 'background',
      },
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'register-asset',
      asset: {
        assetId: 'asset:font-missing',
        packId: 'pack:shell',
        packVersion: '1.0.0',
        path: 'assets/shell/missing.woff2',
        mime: 'font/woff2',
        kind: 'font',
      },
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-asset',
      screenId: 'title',
      slot: 'background',
      assetId: 'asset:bg-missing',
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-asset',
      screenId: 'title',
      slot: 'font',
      assetId: 'asset:font-missing',
    });

    try {
      render(
        <RuntimeRoot
          initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
          shellProjection={buildRuntimeGameShellProjection(state)}
          shellAssetUrlBase="maps/map-fixture"
        />,
      );
      await waitFor(() =>
        expect(screen.getByTestId('shell-asset-diagnostics')).toBeInTheDocument(),
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Background asset failed to load');
      expect(screen.getByRole('alert')).toHaveTextContent('Font asset');
    } finally {
      Object.defineProperty(window, 'Image', { configurable: true, value: originalImage });
    }
  });

  it('keeps held gamepad Back edge-triggered while directional navigation repeats', async () => {
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const makeButton = (pressed = false) => ({ pressed, touched: pressed, value: pressed ? 1 : 0 });
    const buttons = Array.from({ length: 17 }, () => makeButton());
    const originalGetGamepads = navigator.getGamepads;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: vi.fn(() => [{ buttons, axes: [0, 0, 0, 0], connected: true, index: 0 }]),
    });
    let unmount: (() => void) | undefined;
    const step = (at: number): void => {
      now = at;
      const callback = frame;
      frame = undefined;
      callback?.(at);
    };

    try {
      ({ unmount } = render(
        <RuntimeRoot initialState={{ ...initialMenuState, phase: 'in-match' }} />,
      ));
      expect(screen.getByTestId('in-match')).toBeInTheDocument();

      buttons[1] = makeButton(true);
      step(0);
      await waitFor(() => expect(screen.getByTestId('pause-overlay')).toBeInTheDocument());
      step(250);
      expect(screen.getByTestId('pause-overlay')).toBeInTheDocument();

      buttons[1] = makeButton(false);
      step(300);
      buttons[1] = makeButton(true);
      step(360);
      await waitFor(() => expect(screen.getByTestId('in-match')).toBeInTheDocument());
    } finally {
      unmount?.();
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: originalGetGamepads,
      });
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('handles held activate, delayed direction repeat, wrap, disconnect, and simultaneous direction plus Back', async () => {
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const makeButton = (pressed = false) => ({ pressed, touched: pressed, value: pressed ? 1 : 0 });
    const buttons = Array.from({ length: 17 }, () => makeButton());
    const pad = { buttons, axes: [0, 0, 0, 0], connected: true, index: 0 } as unknown as Gamepad;
    const originalGetGamepads = navigator.getGamepads;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: vi.fn(() => [pad]),
    });
    let unmount: (() => void) | undefined;
    const step = (at: number): void => {
      now = at;
      const callback = frame;
      frame = undefined;
      callback?.(at);
    };

    try {
      ({ unmount } = render(<RuntimeRoot />));
      await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
      screen.getByTestId('play-button').focus();

      buttons[13] = makeButton(true);
      step(0);
      expect(screen.getByTestId('settings-button')).toHaveFocus();
      step(50);
      expect(screen.getByTestId('settings-button')).toHaveFocus();
      step(200);
      expect(screen.getByRole('button', { name: /Credits/ })).toHaveFocus();
      step(400);
      expect(screen.getByTestId('play-button')).toHaveFocus();

      buttons[13] = makeButton(false);
      buttons[0] = makeButton(true);
      step(450);
      await waitFor(() => expect(screen.getByTestId('lobby')).toBeInTheDocument());
      step(700);
      expect(screen.getByTestId('lobby')).toBeInTheDocument();

      buttons[0] = makeButton(false);
      step(760);
      screen.getByTestId('start-match').focus();
      buttons[0] = makeButton(true);
      step(820);
      await waitFor(() => expect(screen.getByTestId('in-match')).toBeInTheDocument());

      const disconnect = new Event('gamepaddisconnected');
      Object.defineProperty(disconnect, 'gamepad', { value: { index: 0 } });
      window.dispatchEvent(disconnect);
      (pad as unknown as { connected: boolean }).connected = false;
      buttons[1] = makeButton(true);
      step(900);
      expect(screen.getByTestId('in-match')).toBeInTheDocument();

      buttons[0] = makeButton(false);
      buttons[1] = makeButton(false);
      (pad as unknown as { connected: boolean }).connected = true;
      step(960);
      buttons[1] = makeButton(true);
      step(1020);
      await waitFor(() => expect(screen.getByTestId('pause-overlay')).toBeInTheDocument());

      buttons[1] = makeButton(false);
      step(1080);
      buttons[13] = makeButton(true);
      buttons[1] = makeButton(true);
      step(1260);
      await waitFor(() => expect(screen.getByTestId('in-match')).toBeInTheDocument());
    } finally {
      unmount?.();
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: originalGetGamepads,
      });
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('uses Escape to pause, resume, and return through lobby/results without a second state owner', async () => {
    const user = userEvent.setup();
    render(<RuntimeRoot />);
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());

    await user.click(screen.getByTestId('play-button'));
    expect(screen.getByTestId('lobby')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());

    await user.click(screen.getByTestId('play-button'));
    await user.click(screen.getByTestId('start-match'));
    expect(screen.getByTestId('in-match')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('pause-overlay')).toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('in-match')).toBeInTheDocument());

    await user.click(screen.getByTestId('end-match'));
    expect(screen.getByTestId('results-screen')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'BrowserBack' });
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
  });

  it('gates match start, pause, and resume on lifecycle hooks', async () => {
    const user = userEvent.setup();
    let resolveStart: (() => void) | undefined;
    let resolvePause: (() => void) | undefined;
    let resolveResume: (() => void) | undefined;
    const calls: string[] = [];
    render(
      <RuntimeRoot
        onMatchStart={() =>
          new Promise<void>((resolve) => {
            calls.push('start');
            resolveStart = resolve;
          })
        }
        onPause={() =>
          new Promise<void>((resolve) => {
            calls.push('pause');
            resolvePause = resolve;
          })
        }
        onResume={() =>
          new Promise<void>((resolve) => {
            calls.push('resume');
            resolveResume = resolve;
          })
        }
      />,
    );
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());

    await user.click(screen.getByTestId('play-button'));
    await user.click(screen.getByTestId('start-match'));
    expect(screen.queryByTestId('in-match')).toBeNull();
    expect(calls).toEqual(['start']);
    resolveStart?.();
    await waitFor(() => expect(screen.getByTestId('in-match')).toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('pause-overlay')).toBeNull();
    expect(calls).toEqual(['start', 'pause']);
    resolvePause?.();
    await waitFor(() => expect(screen.getByTestId('pause-overlay')).toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('in-match')).toBeNull();
    expect(calls).toEqual(['start', 'pause', 'resume']);
    resolveResume?.();
    await waitFor(() => expect(screen.getByTestId('in-match')).toBeInTheDocument());
  });

  it('keeps the current shell state visible and reports lifecycle hook rejection', async () => {
    const user = userEvent.setup();
    render(
      <RuntimeRoot onMatchStart={() => Promise.reject(new Error('runtime session stopped'))} />,
    );
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());

    await user.click(screen.getByTestId('play-button'));
    await user.click(screen.getByTestId('start-match'));

    await waitFor(() =>
      expect(screen.getByRole('alertdialog')).toHaveTextContent('runtime session stopped'),
    );
    expect(screen.queryByTestId('in-match')).toBeNull();
  });

  it('opens settings, switches tabs, and goes back', async () => {
    const user = userEvent.setup();
    render(<RuntimeRoot />);
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());

    await user.click(screen.getByTestId('settings-button'));
    expect(screen.getByTestId('settings-dialog')).toBeInTheDocument();

    await user.click(screen.getByTestId('settings-tab-accessibility'));
    expect(screen.getByTestId('settings-tab-body').textContent).toMatch(/colorblind/i);

    await user.click(screen.getByTestId('settings-back'));
    expect(screen.getByTestId('main-menu')).toBeInTheDocument();
  });

  it('forwards shell lifecycle and action events to the behavior bridge', async () => {
    const user = userEvent.setup();
    const events: Parameters<RuntimeShellBehaviorBridge['emitShellEvent']>[0][] = [];
    const shellBridge: RuntimeShellBehaviorBridge = {
      emitShellEvent: (event) => events.push(event),
    };

    render(<RuntimeRoot shellBridge={shellBridge} />);
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
    await user.click(screen.getByTestId('settings-button'));
    await waitFor(() => expect(screen.getByTestId('settings-dialog')).toBeInTheDocument());

    expect(events).toEqual(
      expect.arrayContaining([
        { event: 'shell.title.entered', screenId: 'title' },
        { event: 'shell.menu.entered', screenId: 'main-menu' },
        {
          event: 'shell.action.invoked',
          screenId: 'main-menu',
          actionId: 'main-menu.settings',
          targetScreenId: 'settings',
        },
        { event: 'shell.settings.entered', screenId: 'settings' },
      ]),
    );
  });

  it('applies returned shell navigation requests through the shell-owned reducer', async () => {
    const shellBridge: RuntimeShellBehaviorBridge = {
      shellNavigationRequests: [
        { epoch: 'room-a', sequence: 1, request: { type: 'navigate', targetScreenId: 'settings' } },
      ],
      emitShellEvent: vi.fn(),
    };

    render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellBridge={shellBridge}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('settings-dialog')).toBeInTheDocument());
  });

  it('does not drop equal-length replacement shell navigation batches', async () => {
    const shellBridge: RuntimeShellBehaviorBridge = {
      shellNavigationRequests: [
        { epoch: 'room-a', sequence: 1, request: { type: 'navigate', targetScreenId: 'settings' } },
      ],
      emitShellEvent: vi.fn(),
    };

    const { rerender } = render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellBridge={shellBridge}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('settings-dialog')).toBeInTheDocument());

    rerender(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellBridge={{
          ...shellBridge,
          shellNavigationRequests: [
            {
              epoch: 'room-a',
              sequence: 2,
              request: { type: 'navigate', targetScreenId: 'main-menu' },
            },
          ],
        }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
  });

  it('accepts a repeated shell navigation sequence when the room epoch changes', async () => {
    const shellBridge: RuntimeShellBehaviorBridge = {
      shellNavigationRequests: [
        { epoch: 'room-a', sequence: 0, request: { type: 'navigate', targetScreenId: 'settings' } },
      ],
      emitShellEvent: vi.fn(),
    };

    const { rerender } = render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellBridge={shellBridge}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('settings-dialog')).toBeInTheDocument());

    rerender(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellBridge={{
          ...shellBridge,
          shellNavigationRequests: [
            {
              epoch: 'room-b',
              sequence: 0,
              request: { type: 'navigate', targetScreenId: 'main-menu' },
            },
          ],
        }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
  });

  it('renders live audio mixer settings and binds them to the runtime audio engine', async () => {
    const user = userEvent.setup();
    const setSettings = vi.fn();
    const setFocusState = vi.fn();
    const dispose = vi.fn();
    const engineFactory = vi.fn(() => ({
      playCue: vi.fn(),
      setSettings,
      setFocusState,
      snapshot: vi.fn(() => ({
        supported: true,
        focusState: 'focused' as const,
        settings: {
          masterVolume: 0.8,
          muted: false,
          muteOnFocusLoss: true,
          busVolumes: {},
        },
        playCount: 0,
        audiblePlayCount: 0,
        unsupportedPlayCount: 0,
      })),
      dispose,
    }));
    function AudioHarness(): ReactElement {
      const [settings, setAudioSettings] = useState({
        masterVolume: 0.8,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: {},
      });
      return (
        <RuntimeRoot
          audio={{
            settings,
            buses: [
              {
                id: 'battle-royale.sfx',
                label: 'Battle Royale SFX',
                kind: 'sfx',
                defaultVolume: 0.85,
              },
            ],
            cues: [
              {
                id: 'battle-royale.weapon.fire',
                label: 'Weapon fire',
                busId: 'battle-royale.sfx',
                defaultVolume: 0.72,
              },
            ],
            engineFactory,
            onChange: setAudioSettings,
          }}
        />
      );
    }
    render(<AudioHarness />);
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());
    expect(engineFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        buses: [expect.objectContaining({ id: 'battle-royale.sfx' })],
        cues: [expect.objectContaining({ id: 'battle-royale.weapon.fire' })],
      }),
    );

    await user.click(screen.getByTestId('settings-button'));
    await user.click(screen.getByTestId('settings-tab-audio'));

    expect(screen.getByTestId('audio-settings')).toBeInTheDocument();
    expect(screen.getByTestId('audio-master-volume')).toHaveValue('80');
    expect(screen.getByTestId('audio-bus-battle-royale.sfx')).toHaveValue('85');

    fireEvent.change(screen.getByTestId('audio-master-volume'), { target: { value: '55' } });
    await waitFor(() => {
      expect(setSettings).toHaveBeenLastCalledWith({
        masterVolume: 0.55,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: {},
      });
    });
    expect(engineFactory).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('audio-bus-battle-royale.sfx'), {
      target: { value: '40' },
    });
    await waitFor(() => {
      expect(setSettings).toHaveBeenLastCalledWith({
        masterVolume: 0.55,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: { 'battle-royale.sfx': 0.4 },
      });
    });
    expect(engineFactory).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('audio-muted'));
    await waitFor(() => {
      expect(setSettings).toHaveBeenLastCalledWith({
        masterVolume: 0.55,
        muted: true,
        muteOnFocusLoss: true,
        busVolumes: { 'battle-royale.sfx': 0.4 },
      });
    });
    expect(engineFactory).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('blur'));
    expect(setFocusState).toHaveBeenLastCalledWith('backgrounded');
  });

  it('dispatches shipped gameplay lifecycle audio from authoritative HUD events', async () => {
    const playCue = vi.fn();
    const engineFactory = vi.fn(() => ({
      playCue,
      setSettings: vi.fn(),
      setFocusState: vi.fn(),
      snapshot: vi.fn(() => ({
        supported: true,
        focusState: 'focused' as const,
        settings: {
          masterVolume: 1,
          muted: false,
          muteOnFocusLoss: true,
          busVolumes: {},
        },
        playCount: 0,
        audiblePlayCount: 0,
        unsupportedPlayCount: 0,
      })),
      dispose: vi.fn(),
    }));
    const audio = {
      settings: {
        masterVolume: 1,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: {},
      },
      buses: [{ id: 'sfx', label: 'SFX', kind: 'sfx' as const, defaultVolume: 1 }],
      cues: [
        {
          id: 'cue:collect',
          label: 'Collect',
          busId: 'sfx',
          defaultVolume: 1,
          binding: 'item.collect',
        },
        { id: 'cue:hit', label: 'Hit', busId: 'sfx', defaultVolume: 1, binding: 'player.hit' },
        {
          id: 'cue:eliminated',
          label: 'Eliminated',
          busId: 'sfx',
          defaultVolume: 1,
          binding: 'player.eliminated',
        },
        {
          id: 'cue:zone',
          label: 'Zone',
          busId: 'sfx',
          defaultVolume: 1,
          binding: 'environment.zoneWarning',
        },
        { id: 'cue:end', label: 'End', busId: 'sfx', defaultVolume: 1, binding: 'match.end' },
        { id: 'cue:fire', label: 'Fire', busId: 'sfx', defaultVolume: 1, binding: 'weapon.fire' },
      ],
      engineFactory,
    };
    const gameplayEvents = [
      {
        _tag: 'WeaponFired',
        sourceId: entityId('player-1'),
        weaponId: entityId('battle-royale.primary'),
        origin: { x: 1, y: 2 },
        direction: { x: 1, y: 0 },
        damage: 25,
        ammoRemaining: 11,
        tick: 8,
      },
      {
        _tag: 'WeaponFired',
        sourceId: entityId('player-2'),
        weaponId: entityId('battle-royale.primary'),
        origin: { x: 10, y: 12 },
        direction: { x: 0, y: 1 },
        damage: 25,
        ammoRemaining: 11,
        tick: 8,
      },
      {
        _tag: 'ItemGranted',
        targetId: entityId('player-1'),
        itemId: itemId('health-pack:rare'),
        quantity: 1,
        tick: 1,
      },
      {
        _tag: 'DamageApplied',
        targetId: entityId('player-1'),
        sourceId: entityId('player-2'),
        amount: 12,
        healthBefore: 100,
        healthAfter: 88,
        tick: 2,
      },
      {
        _tag: 'EntityDefeated',
        targetId: entityId('player-2'),
        sourceId: entityId('player-1'),
        tick: 3,
      },
      { _tag: 'ZonePhaseChanged', phase: 'shrinking', previousPhase: 'countdown', tick: 4 },
      {
        _tag: 'MatchPhaseChanged',
        phase: 'finished',
        winnerId: entityId('player-1'),
        tick: 5,
      },
    ];
    const gameplayAudioEvents = gameplayEvents.map((event, sequence) => ({ sequence, event }));

    const { rerender } = render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'in-match' as const }}
        audio={audio}
        gameplayAudioEvents={gameplayAudioEvents}
        hudMetrics={{ playerCount: 2, tickCount: 5, hud: { totalPlayers: 2, gameplayEvents } }}
      />,
    );

    await waitFor(() => {
      expect(playCue).toHaveBeenCalledWith('cue:collect');
      expect(playCue).toHaveBeenCalledWith('cue:hit');
      expect(playCue).toHaveBeenCalledWith('cue:eliminated');
      expect(playCue).toHaveBeenCalledWith('cue:zone');
      expect(playCue).toHaveBeenCalledWith('cue:end');
      expect(playCue.mock.calls.filter(([cueId]) => cueId === 'cue:fire')).toHaveLength(2);
    });
    const lifecycleCallCount = playCue.mock.calls.length;

    rerender(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'in-match' as const }}
        audio={audio}
        gameplayAudioEvents={gameplayAudioEvents}
        hudMetrics={{ playerCount: 2, tickCount: 5, hud: { totalPlayers: 2, gameplayEvents } }}
      />,
    );

    await waitFor(() => expect(playCue).toHaveBeenCalledTimes(lifecycleCallCount));
  });

  it('plays the same accepted fire cue once per retried browser match', async () => {
    const user = userEvent.setup();
    const playCue = vi.fn();
    const engineFactory = vi.fn(() => ({
      playCue,
      setSettings: vi.fn(),
      setFocusState: vi.fn(),
      snapshot: vi.fn(() => ({
        supported: true,
        focusState: 'focused' as const,
        settings: {
          masterVolume: 1,
          muted: false,
          muteOnFocusLoss: true,
          busVolumes: {},
        },
        playCount: 0,
        audiblePlayCount: 0,
        unsupportedPlayCount: 0,
      })),
      dispose: vi.fn(),
    }));
    const audio = {
      settings: {
        masterVolume: 1,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: {},
      },
      buses: [{ id: 'sfx', label: 'SFX', kind: 'sfx' as const, defaultVolume: 1 }],
      cues: [
        { id: 'cue:fire', label: 'Fire', busId: 'sfx', defaultVolume: 1, binding: 'weapon.fire' },
      ],
      engineFactory,
    };
    const acceptedFireEvent = {
      _tag: 'WeaponFired',
      sourceId: entityId('player-1'),
      weaponId: entityId('battle-royale.primary'),
      origin: { x: 1, y: 2 },
      direction: { x: 1, y: 0 },
      damage: 25,
      ammoRemaining: 11,
      tick: 8,
    } as const;
    let setGameplayEvents:
      | ((events: readonly [typeof acceptedFireEvent] | readonly []) => void)
      | undefined;
    let setGameplayAudioEvents:
      | ((
          events:
            | readonly [{ readonly sequence: number; readonly event: typeof acceptedFireEvent }]
            | readonly [],
        ) => void)
      | undefined;
    function RetryHarness(): ReactElement {
      const [gameplayEvents, setEvents] = useState<
        readonly [typeof acceptedFireEvent] | readonly []
      >([]);
      const [gameplayAudioEvents, setAudioEvents] = useState<
        | readonly [{ readonly sequence: number; readonly event: typeof acceptedFireEvent }]
        | readonly []
      >([]);
      setGameplayEvents = setEvents;
      setGameplayAudioEvents = setAudioEvents;
      return (
        <RuntimeRoot
          audio={audio}
          gameplayAudioEvents={gameplayAudioEvents}
          hudMetrics={{
            playerCount: 1,
            tickCount: 8,
            hud: { totalPlayers: 1, gameplayEvents },
          }}
        />
      );
    }

    render(<RetryHarness />);
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());

    await user.click(screen.getByTestId('play-button'));
    await user.click(screen.getByTestId('start-match'));
    setGameplayEvents?.([acceptedFireEvent]);
    setGameplayAudioEvents?.([{ sequence: 0, event: acceptedFireEvent }]);
    await waitFor(() =>
      expect(playCue.mock.calls.filter(([cueId]) => cueId === 'cue:fire')).toHaveLength(1),
    );

    await user.click(screen.getByTestId('end-match'));
    await user.click(screen.getByTestId('play-again'));
    await user.click(screen.getByTestId('start-match'));
    setGameplayEvents?.([]);
    setGameplayAudioEvents?.([]);
    setGameplayEvents?.([acceptedFireEvent]);
    setGameplayAudioEvents?.([{ sequence: 0, event: acceptedFireEvent }]);
    await waitFor(() =>
      expect(playCue.mock.calls.filter(([cueId]) => cueId === 'cue:fire')).toHaveLength(2),
    );
  });

  it('renders contributed sections into named slots and lets them drive the shell', async () => {
    const user = userEvent.setup();
    const sections: MenuSectionRegistration[] = [
      {
        id: 'br-lobby',
        slot: 'main.primaryActions',
        order: 10,
        source: 'plugin',
        Component: ({ onPlay }) => (
          <button type="button" data-testid="section-play" onClick={onPlay}>
            Quick play
          </button>
        ),
      },
    ];
    render(<RuntimeRoot sections={sections} />);
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());

    const section = screen.getByTestId('section-play');
    expect(section).toBeInTheDocument();
    await user.click(section);
    expect(screen.getByTestId('lobby')).toBeInTheDocument();
  });

  it('lets products replace the lobby surface while reusing shell navigation', async () => {
    const user = userEvent.setup();
    render(
      <RuntimeRoot
        renderLobby={({ onStartMatch, onBack }) => (
          <div data-testid="custom-lobby">
            <button type="button" data-testid="custom-start" onClick={onStartMatch}>
              Start
            </button>
            <button type="button" data-testid="custom-back" onClick={onBack}>
              Back
            </button>
          </div>
        )}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('main-menu')).toBeInTheDocument());

    await user.click(screen.getByTestId('play-button'));
    expect(screen.getByTestId('custom-lobby')).toBeInTheDocument();
    await user.click(screen.getByTestId('custom-start'));
    expect(screen.getByTestId('in-match')).toBeInTheDocument();
  });

  it('enters the product lobby from the authored Electron shell before start action side effects', async () => {
    const user = userEvent.setup();
    const projection = await battleRoyaleFixtureProjection();
    const events: Parameters<RuntimeShellBehaviorBridge['emitShellEvent']>[0][] = [];
    render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu', screen: 'main' }}
        shellProjection={projection}
        shellBridge={{ emitShellEvent: (event) => events.push(event) }}
        renderLobby={() => <div data-testid="custom-lobby">Lobby</div>}
      />,
    );

    await user.click(await screen.findByTestId('shell-action-title-start'));
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).toBeInTheDocument());
    await user.click(screen.getByTestId('shell-action-menu-settings'));
    await waitFor(() => expect(screen.getByTestId('settings-dialog')).toBeInTheDocument());
    await user.click(screen.getByTestId('shell-action-settings-back'));
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).toBeInTheDocument());

    await user.click(screen.getByTestId('shell-action-menu-single'));

    await waitFor(() => expect(screen.getByTestId('custom-lobby')).toBeInTheDocument());
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'shell.action.invoked',
          screenId: 'main-menu',
          actionId: 'menu.single',
        }),
      ]),
    );
  });

  it('surfaces a boot failure in the error panel', async () => {
    const user = userEvent.setup();
    render(<RuntimeRoot onBoot={() => Promise.reject(new Error('atlas missing'))} />);
    await waitFor(() => expect(screen.getByTestId('error-panel')).toBeInTheDocument());
    expect(screen.getByText('atlas missing')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back to menu/i }));
    expect(screen.getByTestId('main-menu')).toBeInTheDocument();
  });

  it('mounts the HUD chassis with custom plugin widgets while in-match', () => {
    const inMatch = { ...initialMenuState, phase: 'in-match' as const };
    render(
      <RuntimeRoot
        initialState={inMatch}
        hudMetrics={{
          playerCount: 3,
          tickCount: 50,
          hud: { totalPlayers: 8, gameplayEvents: [] },
        }}
        hudLayout={Schema.decodeUnknownSync(HudLayout)({
          id: 'test.runtime-hud',
          widgets: [
            {
              id: 'alive',
              kind: CORE_HUD_WIDGETS.AliveCount,
              anchor: 'top-right',
              order: 0,
              enabled: true,
            },
            { id: 'mana', kind: 'arena.manaBar', anchor: 'bottom-left', order: 0, enabled: true },
          ],
        })}
        hudWidgets={[
          {
            kind: 'arena.manaBar',
            source: 'plugin',
            Component: () => <div data-testid="arena-mana-bar">MP 12</div>,
          },
        ]}
      />,
    );

    expect(screen.getByTestId('playtest-hud-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('playtest-hud-alive-count').textContent).toBe('3 / 8 players alive');
    expect(screen.getByTestId('arena-mana-bar').textContent).toBe('MP 12');
    // The menu shell's in-match stub still renders alongside the HUD.
    expect(screen.getByTestId('in-match')).toBeInTheDocument();
  });

  it('does not mount the HUD outside of a match', () => {
    render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: 'menu' as const }}
        hudMetrics={{ playerCount: 1, tickCount: 1 }}
      />,
    );
    expect(screen.queryByTestId('playtest-hud-overlay')).toBeNull();
  });
});
