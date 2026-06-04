import { Schema } from 'effect';
import type { Uuid } from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import {
  AbilityId,
  StatusEffectId,
  WeaponDefinitionId,
  makeAbilityId,
  makeCombatEntityId,
  makeStatusEffectId,
  makeTeamId,
  makeWeaponDefinitionId,
} from './ids.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000' as Uuid;

describe('combat branded ids', () => {
  it('constructs and round-trips a weapon id', () => {
    const id = makeWeaponDefinitionId(UUID);
    expect(id).toBe(`weapon:${UUID}`);
    expect(Schema.decodeUnknownSync(WeaponDefinitionId)(id)).toBe(id);
  });

  it('constructs status and ability ids with their prefixes', () => {
    expect(makeStatusEffectId(UUID)).toBe(`status:${UUID}`);
    expect(makeAbilityId(UUID)).toBe(`ability:${UUID}`);
    expect(Schema.decodeUnknownSync(StatusEffectId)(`status:${UUID}`)).toBeDefined();
    expect(Schema.decodeUnknownSync(AbilityId)(`ability:${UUID}`)).toBeDefined();
  });

  it('rejects a wrong prefix', () => {
    expect(() => Schema.decodeUnknownSync(WeaponDefinitionId)(`status:${UUID}`)).toThrow();
    expect(() => Schema.decodeUnknownSync(AbilityId)('ability:not-a-uuid')).toThrow();
  });

  it('brands entity and team values without altering their runtime shape', () => {
    expect(makeCombatEntityId(7)).toBe(7);
    expect(makeTeamId('blue')).toBe('blue');
  });
});
