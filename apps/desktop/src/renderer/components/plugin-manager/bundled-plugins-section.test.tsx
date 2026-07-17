// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const battleRoyalePluginId = vi.hoisted(() => ['@tileborne-plugins', 'battle-royale'].join('/'));
const arenaPluginId = vi.hoisted(() => ['@tileborne-plugins', 'example-arena'].join('/'));

vi.mock('@/hooks/queries', () => ({
  usePluginsList: () => ({
    data: {
      plugins: [
        {
          id: battleRoyalePluginId,
          version: '0.1.0',
          enabled: true,
          rootPath: '/plugins/battle-royale',
          manifestPath: '/plugins/battle-royale/tileborne-plugin.json',
        },
        {
          id: arenaPluginId,
          version: '0.1.0',
          enabled: true,
          rootPath: '/plugins/example-arena',
          manifestPath: '/plugins/example-arena/tileborne-plugin.json',
        },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/mutations', () => ({
  useInstallBattleRoyalePlugin: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/battle-royale-plugin', () => ({ BATTLE_ROYALE_PLUGIN_ID: battleRoyalePluginId }));

vi.mock('@/stores/app-notifications-store', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

import { BundledPluginsSection } from '@/components/plugin-manager/bundled-plugins-section';

describe('BundledPluginsSection', () => {
  afterEach(() => {
    cleanup();
  });

  it('lists ALL installed plugins generically (battle royale AND the example arena)', () => {
    render(<BundledPluginsSection />);

    expect(screen.getByText(battleRoyalePluginId)).toBeTruthy();
    expect(screen.getByText(arenaPluginId)).toBeTruthy();
    // Both seeded → no Battle-Royale-only install fallback is shown.
    expect(screen.queryByTestId('install-battle-royale-manager')).toBeNull();
  });
});
