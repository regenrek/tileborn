// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documentState = vi.hoisted(() => ({
  current: {
    schemaVersion: 1,
    assets: [] as Array<{
      label: string;
      source: {
        assetId?: string;
        packId?: string;
        packVersion?: string;
        path?: string;
        url?: string;
        mime?: string;
      };
      classification: string;
    }>,
    bindings: {} as Record<string, string>,
    settings: {
      masterVolume: 0.7,
      muted: false,
      muteOnFocusLoss: true,
      busVolumes: { 'project.music': 0.4, 'project.sfx': 0.6 },
    },
  },
}));

const applyCalls = vi.hoisted(() => [] as unknown[]);
const saveCalls = vi.hoisted(() => [] as unknown[]);
const previewCalls = vi.hoisted(() => [] as unknown[]);
const playCueMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: 'project:audio' }),
}));

vi.mock('@tileborne/game-client', () => ({
  createBrowserRuntimeAudioEngine: vi.fn(() => ({
    playCue: playCueMock,
    dispose: disposeMock,
  })),
}));

vi.mock('@/hooks/queries', () => ({
  useProjectAudio: () => ({ data: { document: documentState.current } }),
  useAssetPacks: () => ({
    data: {
      packs: [
        {
          id: 'pack:audio',
          name: 'Licensed Audio',
          version: '1.0.0',
          licenseSpdxId: 'CC0-1.0',
          integrityHash: 'sha256:audio',
          assetCount: 2,
          capability: {},
        },
        {
          id: 'pack:other',
          name: 'Other Audio',
          version: '1.0.0',
          licenseSpdxId: 'CC0-1.0',
          integrityHash: 'sha256:other',
          assetCount: 1,
          capability: {},
        },
      ],
    },
  }),
  useAssetPackAssets: () => ({
    data: {
      assets: [
        { id: 'asset:menu-loop', path: 'assets/audio/menu-loop.ogg', mime: 'audio/ogg' },
        { id: 'asset:menu-loop-v2', path: 'assets/audio/menu-loop-v2.ogg', mime: 'audio/ogg' },
      ],
    },
  }),
}));

vi.mock('@/hooks/mutations', () => ({
  useApplyProjectAudioCommand: () => ({
    data: { projection: { diagnostics: [] } },
    mutate: (input: {
      command: {
        type: string;
        label?: string;
        source?: unknown;
        classification?: string;
        binding?: string;
      };
    }) => {
      applyCalls.push(input);
      const command = input.command;
      if (command.type === 'import' && command.label !== undefined) {
        documentState.current = {
          ...documentState.current,
          assets: [
            ...documentState.current.assets.filter((asset) => asset.label !== command.label),
            {
              label: command.label,
              source: command.source as {
                assetId?: string;
                packId?: string;
                packVersion?: string;
                path?: string;
                url?: string;
                mime?: string;
              },
              classification: command.classification ?? 'sfx',
            },
          ],
        };
      }
      if (command.type === 'classify' && command.label !== undefined) {
        documentState.current = {
          ...documentState.current,
          assets: documentState.current.assets.map((asset) =>
            asset.label === command.label
              ? { ...asset, classification: command.classification ?? asset.classification }
              : asset,
          ),
        };
      }
      if (command.type === 'bind' && command.label !== undefined && command.binding !== undefined) {
        documentState.current = {
          ...documentState.current,
          bindings: { ...documentState.current.bindings, [command.binding]: command.label },
        };
      }
      if (command.type === 'replace' && command.label !== undefined) {
        documentState.current = {
          ...documentState.current,
          assets: documentState.current.assets.map((asset) =>
            asset.label === command.label
              ? { ...asset, source: command.source as typeof asset.source }
              : asset,
          ),
        };
      }
      if (command.type === 'remove' && command.label !== undefined) {
        documentState.current = {
          ...documentState.current,
          assets: documentState.current.assets.filter((asset) => asset.label !== command.label),
          bindings: Object.fromEntries(
            Object.entries(documentState.current.bindings).filter(
              ([, value]) => value !== command.label,
            ),
          ),
        };
      }
    },
  }),
  usePreviewProjectAudio: () => ({
    data: {
      playable: true,
      source: { assetId: 'asset:menu-loop', path: 'assets/audio/menu-loop.ogg', mime: 'audio/ogg' },
      diagnostics: [],
    },
    mutate: (
      input: unknown,
      options?: {
        onSuccess?: (data: {
          source: {
            assetId: string;
            packId?: string;
            packVersion?: string;
            path: string;
            mime: string;
          };
        }) => void;
      },
    ) => {
      previewCalls.push(input);
      options?.onSuccess?.({
        source: {
          assetId: 'asset:menu-loop',
          packId: 'pack:audio',
          packVersion: '1.0.0',
          path: 'assets/audio/menu-loop.ogg',
          mime: 'audio/ogg',
        },
      });
    },
  }),
  useSaveProjectAudio: () => ({
    mutate: (input: unknown) => saveCalls.push(input),
  }),
}));

import { AudioPage } from './audio-page';

describe('AudioPage', () => {
  beforeEach(() => {
    Object.assign(window, {
      tileborne: {
        assets: {
          getAssetDataUrl: vi.fn(async () => ({ dataUrl: 'data:audio/ogg;base64,T2dnUw==' })),
        },
      },
    });
    documentState.current = {
      schemaVersion: 1,
      assets: [],
      bindings: {},
      settings: {
        masterVolume: 0.7,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: { 'project.music': 0.4, 'project.sfx': 0.6 },
      },
    };
    applyCalls.length = 0;
    saveCalls.length = 0;
    previewCalls.length = 0;
    playCueMock.mockClear();
    disposeMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('imports, classifies, binds, replaces, previews audibly, removes, and reopens authored audio', async () => {
    const { rerender } = render(<AudioPage />);

    fireEvent.change(screen.getByTestId('audio-label'), { target: { value: 'Menu Loop' } });
    expect(screen.getByTestId('audio-selected-license').textContent).toContain('CC0-1.0');
    fireEvent.click(screen.getByTestId('audio-import'));

    rerender(<AudioPage />);
    expect(screen.getByText('Menu Loop')).toBeDefined();
    expect(applyCalls.at(-1)).toMatchObject({
      projectId: 'project:audio',
      command: {
        type: 'import',
        label: 'Menu Loop',
        source: {
          assetId: 'asset:menu-loop',
          packId: 'pack:audio',
          packVersion: '1.0.0',
          path: 'assets/audio/menu-loop.ogg',
          mime: 'audio/ogg',
        },
      },
    });

    fireEvent.click(screen.getByText('Classify'));
    fireEvent.click(screen.getByTestId('audio-bind'));
    fireEvent.change(screen.getByTestId('audio-asset-select'), {
      target: { value: 'asset:menu-loop-v2' },
    });
    fireEvent.click(screen.getByTestId('audio-replace'));
    fireEvent.click(screen.getByTestId('audio-preview'));

    expect(previewCalls).toHaveLength(1);
    await waitFor(() => expect(playCueMock).toHaveBeenCalledWith('project.preview'));
    expect(window.tileborne.assets.getAssetDataUrl).toHaveBeenCalledWith({
      packId: 'pack:audio',
      assetPath: 'assets/audio/menu-loop.ogg',
    });

    fireEvent.click(screen.getByText('Remove'));
    rerender(<AudioPage />);
    expect(screen.getByText('No audio labels yet.')).toBeDefined();

    fireEvent.click(screen.getByTestId('audio-save-volume'));
    await waitFor(() => expect(saveCalls).toHaveLength(1));

    rerender(<AudioPage />);
    expect((screen.getByTestId('audio-master-volume') as HTMLInputElement).value).toBe('0.7');
    expect((screen.getByTestId('audio-music-volume') as HTMLInputElement).value).toBe('0.4');
    expect((screen.getByTestId('audio-sfx-volume') as HTMLInputElement).value).toBe('0.6');
  });

  it('previews from the saved source pack instead of the currently selected pack', async () => {
    render(<AudioPage />);

    fireEvent.change(screen.getByTestId('audio-pack-select'), { target: { value: 'pack:other' } });
    fireEvent.click(screen.getByTestId('audio-preview'));

    await waitFor(() => expect(playCueMock).toHaveBeenCalledWith('project.preview'));
    expect(window.tileborne.assets.getAssetDataUrl).toHaveBeenCalledWith({
      packId: 'pack:audio',
      assetPath: 'assets/audio/menu-loop.ogg',
    });
  });
});
