import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AuthoringFieldSchema,
  authoringDefaults,
  validateAuthoringValues,
  type AuthoringFieldSchema as Field,
} from './field-schema.js';

const fields: readonly Field[] = [
  { kind: 'number', key: 'speed', label: 'Speed', default: 4, min: 0, max: 10 },
  { kind: 'text', key: 'name', label: 'Name', default: 'Actor', minLength: 2 },
  { kind: 'boolean', key: 'enabled', label: 'Enabled', default: true },
  {
    kind: 'enum',
    key: 'stance',
    label: 'Stance',
    default: 'idle',
    options: [
      { value: 'idle', label: 'Idle' },
      { value: 'alert', label: 'Alert' },
    ],
  },
  {
    kind: 'reference',
    key: 'visual',
    label: 'Visual',
    target: 'asset',
    default: 'asset:known',
  },
  {
    kind: 'optional',
    key: 'target',
    label: 'Target',
    field: {
      kind: 'reference',
      key: 'value',
      label: 'Entity',
      target: 'entity',
    },
  },
  {
    kind: 'group',
    key: 'advanced',
    label: 'Advanced',
    fields: [
      { kind: 'number', key: 'weight', label: 'Weight', default: 1, min: 0 },
      { kind: 'text', key: 'tag', label: 'Tag', default: 'common' },
    ],
  },
];

describe('AuthoringFieldSchema', () => {
  it('round-trips every field kind and derives deterministic nested defaults', () => {
    const decoded = fields.map((field) => Schema.decodeUnknownSync(AuthoringFieldSchema)(field));
    expect(decoded.map((field) => field.kind)).toEqual([
      'number',
      'text',
      'boolean',
      'enum',
      'reference',
      'optional',
      'group',
    ]);
    expect(authoringDefaults(decoded)).toEqual({
      speed: 4,
      name: 'Actor',
      enabled: true,
      stance: 'idle',
      visual: 'asset:known',
      target: null,
      advanced: { weight: 1, tag: 'common' },
    });
  });

  it('validates constraints and discoverable reference integrity', () => {
    const valid = authoringDefaults(fields);
    expect(validateAuthoringValues(fields, valid, { asset: new Set(['asset:known']) })).toEqual({
      ok: true,
      issues: [],
    });

    const invalid = validateAuthoringValues(
      fields,
      { ...valid, speed: 11, stance: 'missing', visual: 'asset:missing' },
      { asset: new Set(['asset:known']) },
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.issues.map((issue) => issue.path)).toEqual(['speed', 'stance', 'visual']);
  });
});
