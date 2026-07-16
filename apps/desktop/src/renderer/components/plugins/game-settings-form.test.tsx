// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { materializeGameSettingsForm } from '@tileborne/plugin-api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GameSettingsForm } from '@/components/plugins/game-settings-form';

// A materialized `EditorGameSettingsForm` declaration as projected on the
// discovered game mode (no plugin-specific TS import).
const manifestFormData = {
  scope: 'map' as const,
  invalidMessage: 'Settings must be positive numbers.',
  fields: [
    { key: 'maxPlayers', label: 'Max players', min: 1, step: 1, default: 32 },
    { key: 'damagePerSecOutside', label: 'Zone DPS', min: 1, max: 100, step: 0.5, default: 5 },
  ],
};

const materialize = () => materializeGameSettingsForm(manifestFormData);

describe('GameSettingsForm (generic, manifest-driven)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders fields generically from a manifest EditorGameSettingsForm declaration', () => {
    render(<GameSettingsForm form={materialize()} values={{}} onSave={() => {}} testIdPrefix="mode-setting" />);

    // Defaults from the declaration fill the draft for missing values.
    expect((screen.getByTestId('mode-setting-maxPlayers') as HTMLInputElement).value).toBe('32');
    expect((screen.getByTestId('mode-setting-damagePerSecOutside') as HTMLInputElement).value).toBe('5');
    expect(screen.getByText('Max players')).toBeTruthy();
    expect(screen.getByText('Zone DPS')).toBeTruthy();
  });

  it('saves parsed flat values from edited drafts', () => {
    const onSave = vi.fn();
    render(
      <GameSettingsForm
        form={materialize()}
        values={{ maxPlayers: 8, damagePerSecOutside: 7 }}
        onSave={onSave}
        testIdPrefix="mode-setting"
      />,
    );

    fireEvent.change(screen.getByTestId('mode-setting-maxPlayers'), { target: { value: '16' } });
    fireEvent.click(screen.getByTestId('mode-setting-save'));

    expect(onSave).toHaveBeenCalledWith({ maxPlayers: 16, damagePerSecOutside: 7 });
  });

  it('keeps a dirty draft when an equivalent form object is rematerialized', () => {
    const props = { values: { maxPlayers: 8, damagePerSecOutside: 7 }, onSave: vi.fn() };
    const { rerender } = render(
      <GameSettingsForm form={materialize()} {...props} testIdPrefix="mode-setting" />,
    );
    fireEvent.change(screen.getByTestId('mode-setting-maxPlayers'), { target: { value: '16' } });

    rerender(<GameSettingsForm form={materialize()} {...props} testIdPrefix="mode-setting" />);

    expect((screen.getByTestId('mode-setting-maxPlayers') as HTMLInputElement).value).toBe('16');
  });

  it('blocks the save when a value is out of the declared bounds', () => {
    const onSave = vi.fn();
    render(<GameSettingsForm form={materialize()} values={{}} onSave={onSave} testIdPrefix="mode-setting" />);

    // 0 < min 1 → parse fails → save button disabled (the editor blocks saving).
    fireEvent.change(screen.getByTestId('mode-setting-maxPlayers'), { target: { value: '0' } });
    expect((screen.getByTestId('mode-setting-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('mode-setting-save'));
    expect(onSave).not.toHaveBeenCalled();
  });
});
