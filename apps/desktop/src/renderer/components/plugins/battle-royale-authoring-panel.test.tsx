// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TileborneMap, makeMapId, type Uuid } from '@tileborne/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BATTLE_ROYALE_PLUGIN_ID } from '@/lib/battle-royale-plugin';

import { BattleRoyaleAuthoringPanel } from './battle-royale-authoring-panel';

const updateMap = vi.fn();
const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}` as Uuid;
const weapon = (
  suffix: string,
  label: string,
  origin: 'plugin' | 'project',
  sourcePluginId: string | undefined,
  deliveryTag: string,
) => ({
  entry: { weapon: { id: `weapon:${uuid(suffix)}` }, delivery: { _tag: deliveryTag } },
  label,
  origin,
  ...(sourcePluginId === undefined ? {} : { sourcePluginId }),
});

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/mutations', () => ({
  useUpdateMap: () => ({ mutateAsync: updateMap, isPending: false }),
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/queries', () => ({
  useProject: () => ({ data: undefined }),
  useTilesetPack: () => ({ data: undefined }),
  useResolvedCatalog: () => ({
    data: {
      weapons: [
        weapon('1', 'Pulse Carbine', 'plugin', BATTLE_ROYALE_PLUGIN_ID, 'ProjectileDelivery'),
        weapon('2', 'Arena Blade', 'plugin', '@tileborne-plugins/example-arena', 'MeleeDelivery'),
        weapon('3', 'Project Rifle', 'project', undefined, 'ProjectileDelivery'),
        weapon('4', 'Project Hammer', 'project', undefined, 'MeleeDelivery'),
      ],
    },
  }),
}));
vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: unknown) => unknown) =>
    selector({ brushIntent: { kind: 'none' } }),
}));
vi.mock('@/stores/app-notifications-store', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

const map = new TileborneMap({
  id: makeMapId(uuid('9')),
  schemaVersion: 1,
  size: { width: 8, height: 8 },
  tileSize: { width: 32, height: 32 },
  layers: [],
  objects: [],
  properties: {},
});

describe('BattleRoyaleAuthoringPanel rules', () => {
  afterEach(() => {
    cleanup();
    updateMap.mockReset();
  });

  it('offers only BR-compatible plugin and project projectile weapons by human label', () => {
    render(
      <BattleRoyaleAuthoringPanel projectId="project:test" map={map} settingsForm={undefined} />,
    );

    const select = screen.getByTestId('br-setting-startingWeaponId');
    expect(within(select).getByText('Pulse Carbine')).toBeTruthy();
    expect(within(select).getByText('Project Rifle')).toBeTruthy();
    expect(within(select).queryByText('Arena Blade')).toBeNull();
    expect(within(select).queryByText('Project Hammer')).toBeNull();
  });

  it('switches the explicit match-end policy to continuous when respawn is enabled', () => {
    render(
      <BattleRoyaleAuthoringPanel projectId="project:test" map={map} settingsForm={undefined} />,
    );

    fireEvent.click(screen.getByTestId('br-setting-respawnEnabled'));

    expect((screen.getByTestId('br-setting-matchEndPolicy') as HTMLSelectElement).value).toBe(
      'continuous',
    );
    expect(screen.getByTestId('br-match-end-summary').textContent).toContain('continuous play');
  });
});
