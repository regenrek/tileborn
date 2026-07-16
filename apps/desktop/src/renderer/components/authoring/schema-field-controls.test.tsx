// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AuthoringFieldSchema, JsonObject } from '@tileborne/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchemaFieldControls } from './schema-field-controls';

const fields = [
  { key: 'speed', label: 'Speed', kind: 'number', default: 4, min: 1 },
  { key: 'title', label: 'Title', kind: 'text', default: '' },
  { key: 'enabled', label: 'Enabled', kind: 'boolean', default: true },
  {
    key: 'team',
    label: 'Team',
    kind: 'enum',
    default: 'neutral',
    options: [
      { value: 'neutral', label: 'Neutral' },
      { value: 'player', label: 'Player' },
    ],
  },
  { key: 'weapon', label: 'Weapon', kind: 'reference', target: 'weapon', allowNone: false },
  {
    key: 'advanced',
    label: 'Advanced',
    kind: 'optional',
    field: { key: 'note', label: 'Note', kind: 'text', default: '' },
  },
  {
    key: 'spawn',
    label: 'Spawn',
    kind: 'group',
    fields: [{ key: 'count', label: 'Count', kind: 'number', default: 1, integer: true }],
  },
] satisfies readonly AuthoringFieldSchema[];

describe('SchemaFieldControls', () => {
  afterEach(cleanup);

  it('renders every schema kind and uses labels instead of raw reference ids', () => {
    const onChange = vi.fn();
    const values: JsonObject = {
      speed: 4,
      title: 'Crate',
      enabled: true,
      team: 'neutral',
      weapon: 'weapon:abc',
      advanced: null,
      spawn: { count: 2 },
    };
    render(
      <SchemaFieldControls
        fields={fields}
        values={values}
        references={{ weapon: [{ id: 'weapon:abc', label: 'Pulse rifle' }] }}
        onChange={onChange}
        testIdPrefix="schema"
      />,
    );

    expect(screen.getByText('Pulse rifle')).toBeTruthy();
    expect(screen.getByTestId('schema-spawn-count')).toBeTruthy();
    fireEvent.change(screen.getByTestId('schema-speed'), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ speed: 7 }));
    fireEvent.change(screen.getByTestId('schema-weapon'), { target: { value: 'weapon:abc' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ weapon: 'weapon:abc' }));
  });

  it('surfaces constraint and reference-integrity errors from the core validator', () => {
    render(
      <SchemaFieldControls
        fields={fields}
        values={{
          speed: 0,
          title: '',
          enabled: true,
          team: 'invalid',
          weapon: 'missing',
          advanced: null,
          spawn: { count: 1 },
        }}
        references={{ weapon: [{ id: 'weapon:abc', label: 'Pulse rifle' }] }}
        onChange={() => {}}
        testIdPrefix="schema"
      />,
    );
    expect(screen.getByText('Speed must be at least 1')).toBeTruthy();
    expect(screen.getByText('Team must use a declared option')).toBeTruthy();
    expect(screen.getByText('Weapon references missing weapon missing')).toBeTruthy();
  });

  it('renders bounded asset reference options with the resolved preview', () => {
    const assetFields = [
      { key: 'portrait', label: 'Portrait', kind: 'reference', target: 'asset' },
    ] satisfies readonly AuthoringFieldSchema[];
    render(
      <SchemaFieldControls
        fields={assetFields}
        values={{ portrait: 'pack-a:placeable:hero' }}
        references={{
          asset: [
            {
              id: 'pack-a:placeable:hero',
              label: 'Hero sprite',
              previewUrl: 'tileborne-asset://thumb/hero.png',
            },
          ],
        }}
        onChange={() => {}}
        testIdPrefix="asset-schema"
      />,
    );
    expect(screen.getByText('Hero sprite')).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toBe(
      'tileborne-asset://thumb/hero.png',
    );
  });
});
