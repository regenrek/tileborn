// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarPluginContributions } from '@/components/sidebar/plugin-contribution-zone';

const battleRoyalePluginId = ['@tileborne-plugins', 'battle-royale'].join('/');

describe('SidebarPluginContributions', () => {
  let client: QueryClient;
  let listContributions: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    listContributions = vi.fn(async () => ({
      panels: [
        {
          pluginId: battleRoyalePluginId,
          pluginName: 'Battle Royale',
          id: 'battle-royale-settings',
          zone: 'plugins',
          title: 'Battle Royale Settings',
          description: 'Configure battle royale gameplay.',
          capabilities: ['settings'],
        },
        {
          pluginId: battleRoyalePluginId,
          pluginName: 'Battle Royale',
          id: 'battle-royale-match-rules',
          zone: 'project',
          title: 'Battle Royale Match Rules',
          description: 'Project-level match rules.',
        },
        {
          pluginId: '@tileborne-plugins/asset-tools',
          pluginName: 'Asset Tools',
          id: 'asset-curation-panel',
          zone: 'assets',
          title: 'Asset Curation Panel',
        },
      ],
      tools: [
        {
          pluginId: battleRoyalePluginId,
          pluginName: 'Battle Royale',
          id: 'battle-royale-spawn-tools',
          zone: 'working-palette',
          title: 'Battle Royale Spawn Tools',
          capabilities: ['spawn', 'paint'],
        },
      ],
    }));
    Object.defineProperty(window, 'tileborne', {
      configurable: true,
      value: {
        plugins: { listContributions },
      },
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
  });

  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  it('renders contribution cards in their matching sidebar zones', async () => {
    render(
      <>
        <SidebarPluginContributions zone="project" title="Plugin project panels" />
        <SidebarPluginContributions zone="working-palette" title="Plugin palette tools" />
        <SidebarPluginContributions zone="assets" title="Plugin asset panels" />
        <SidebarPluginContributions zone="plugins" title="Plugin settings" />
      </>,
      { wrapper },
    );

    const projectZone = await screen.findByTestId('sidebar-plugin-zone-project');
    const paletteZone = await screen.findByTestId('sidebar-plugin-zone-working-palette');
    const assetsZone = await screen.findByTestId('sidebar-plugin-zone-assets');
    const pluginsZone = await screen.findByTestId('sidebar-plugin-zone-plugins');

    expect(within(projectZone).getByText('Battle Royale Match Rules')).toBeTruthy();
    expect(within(projectZone).queryByText('Battle Royale Settings')).toBeNull();
    expect(within(paletteZone).getByText('Battle Royale Spawn Tools')).toBeTruthy();
    expect(within(assetsZone).getByText('Asset Curation Panel')).toBeTruthy();
    expect(within(pluginsZone).getByText('Battle Royale Settings')).toBeTruthy();
    expect(within(pluginsZone).getByText('settings')).toBeTruthy();
    expect(within(paletteZone).getByText('spawn, paint')).toBeTruthy();
    expect(screen.queryByText('Renderer placeholder')).toBeNull();
    expect(listContributions).toHaveBeenCalledWith({});
  });
});
