import { CORE_HUD_WIDGETS, HudLayout } from '@tileborne/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaytestHudEditor, type PlaytestHudEditorProps } from './playtest-hud-editor';

const sampleLayout = (): HudLayout =>
  Schema.decodeUnknownSync(HudLayout)({
    id: 'edit-hud',
    widgets: [
      {
        id: 'status',
        kind: CORE_HUD_WIDGETS.LocalPlayerStatus,
        anchor: 'top-left',
        order: 0,
        enabled: true,
      },
      {
        id: 'roster',
        kind: CORE_HUD_WIDGETS.TeamRoster,
        anchor: 'top-left',
        order: 1,
        enabled: false,
      },
      {
        id: 'custom',
        kind: 'myplugin.ManaBar',
        anchor: 'bottom-right',
        order: 0,
        enabled: true,
      },
    ],
  });

const renderEditor = (overrides: Partial<PlaytestHudEditorProps> = {}) => {
  const handlers = {
    onSetAnchor: vi.fn(),
    onSetEnabled: vi.fn(),
    onMoveOrder: vi.fn(),
    onSaveUser: vi.fn(),
    onSaveProject: vi.fn(),
    onResetUser: vi.fn(),
    onClose: vi.fn(),
  };
  render(<PlaytestHudEditor layout={sampleLayout()} {...handlers} {...overrides} />);
  return handlers;
};

afterEach(() => {
  cleanup();
});

describe('PlaytestHudEditor', () => {
  it('lists every widget of the layout including disabled and plugin-declared kinds', () => {
    renderEditor();
    expect(screen.getByText('Local Player Status')).toBeTruthy();
    expect(screen.getByText('Team Roster')).toBeTruthy();
    expect(screen.getByText('Mana Bar')).toBeTruthy();
  });

  it('moves a widget to a clicked anchor', () => {
    const handlers = renderEditor();
    const row = screen.getByTestId('playtest-hud-editor-row-status');
    const target = row.querySelector('[aria-label="Anchor bottom-center"]');
    expect(target).not.toBeNull();
    fireEvent.click(target!);
    expect(handlers.onSetAnchor).toHaveBeenCalledWith('status', 'bottom-center');
  });

  it('toggles widget visibility', () => {
    const handlers = renderEditor();
    fireEvent.click(screen.getByLabelText('Show Team Roster'));
    expect(handlers.onSetEnabled).toHaveBeenCalledWith('roster', true);
  });

  it('reorders widgets within their anchor', () => {
    const handlers = renderEditor();
    fireEvent.click(screen.getByLabelText('Move Team Roster up'));
    expect(handlers.onMoveOrder).toHaveBeenCalledWith('roster', 'up');
    fireEvent.click(screen.getByLabelText('Move Local Player Status down'));
    expect(handlers.onMoveOrder).toHaveBeenCalledWith('status', 'down');
  });

  it('saves, resets and closes via the footer actions', () => {
    const handlers = renderEditor();
    fireEvent.click(screen.getByTestId('playtest-hud-editor-save-user'));
    expect(handlers.onSaveUser).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('playtest-hud-editor-save-project'));
    expect(handlers.onSaveProject).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('playtest-hud-editor-reset'));
    expect(handlers.onResetUser).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('playtest-hud-editor-close'));
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it('hides the project save action when no project is available', () => {
    renderEditor({ onSaveProject: undefined });
    expect(screen.queryByTestId('playtest-hud-editor-save-project')).toBeNull();
  });
});
