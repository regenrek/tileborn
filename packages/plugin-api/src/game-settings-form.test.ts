import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  decodeGameSettingsForm,
  gameSettingsDefaults,
  gameSettingsToDraft,
  materializeGameSettingsForm,
  parseGameSettingsDraft,
} from './game-settings-form.js';

const validData = {
  scope: 'map',
  invalidMessage: 'Battle Royale settings must be positive numbers.',
  fields: [
    { key: 'maxPlayers', label: 'Max players', min: 1, step: 1, default: 32 },
    { key: 'damagePerSecOutside', label: 'Zone DPS', min: 1, max: 100, step: 0.5, default: 5 },
  ],
};

const decodeOrThrow = (data: unknown) => {
  const result = decodeGameSettingsForm('test-form', data);
  if (Result.isFailure(result)) {
    throw new Error(result.failure.message);
  }
  return result.success;
};

describe('decodeGameSettingsForm', () => {
  it('decodes a valid manifest settings-form declaration', () => {
    const result = decodeGameSettingsForm('br-settings', validData);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.scope).toBe('map');
      expect(result.success.fields).toHaveLength(2);
    }
  });

  it('fails on data that is not a valid settings form', () => {
    const result = decodeGameSettingsForm('broken', { scope: 'galaxy', fields: 'nope' });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe('InvalidGameSettingsFormError');
      expect(result.failure.contributionId).toBe('broken');
    }
  });
});

describe('materializeGameSettingsForm + value policy', () => {
  it('flattens Option fields and resolves the invalid message', () => {
    const form = materializeGameSettingsForm(decodeOrThrow(validData));
    expect(form.invalidMessage).toBe('Battle Royale settings must be positive numbers.');
    expect(form.fields[0]).toEqual({
      key: 'maxPlayers',
      label: 'Max players',
      min: 1,
      max: undefined,
      step: 1,
      default: 32,
    });
  });

  it('derives defaults from the field set', () => {
    const form = materializeGameSettingsForm(decodeOrThrow(validData));
    expect(gameSettingsDefaults(form)).toEqual({ maxPlayers: 32, damagePerSecOutside: 5 });
  });

  it('builds a draft from stored values, falling back to defaults', () => {
    const form = materializeGameSettingsForm(decodeOrThrow(validData));
    expect(gameSettingsToDraft(form, { maxPlayers: 12 })).toEqual({
      maxPlayers: '12',
      damagePerSecOutside: '5',
    });
  });

  it('parses a valid draft into typed values', () => {
    const form = materializeGameSettingsForm(decodeOrThrow(validData));
    expect(parseGameSettingsDraft(form, { maxPlayers: '8', damagePerSecOutside: '7.5' })).toEqual({
      maxPlayers: 8,
      damagePerSecOutside: 7.5,
    });
  });

  it('rejects a draft that is non-finite or out of declared bounds', () => {
    const form = materializeGameSettingsForm(decodeOrThrow(validData));
    expect(
      parseGameSettingsDraft(form, { maxPlayers: 'x', damagePerSecOutside: '5' }),
    ).toBeUndefined();
    expect(
      parseGameSettingsDraft(form, { maxPlayers: '0', damagePerSecOutside: '5' }),
    ).toBeUndefined();
    expect(
      parseGameSettingsDraft(form, { maxPlayers: '8', damagePerSecOutside: '999' }),
    ).toBeUndefined();
  });
});
