// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const removeAssetPackMutateAsyncMock = vi.hoisted(() => vi.fn());
const removeAssetPackMock = vi.hoisted(() =>
  vi.fn(() => ({ mutateAsync: removeAssetPackMutateAsyncMock, isPending: false })),
);

vi.mock('@/hooks/mutations', () => ({
  useRemoveAssetPack: removeAssetPackMock,
}));

import { DuplicatePackDialog } from '@/components/duplicate-pack-dialog';
import { useAppNotificationsStore } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

const jobsGetMock = vi.fn();
const getPackMock = vi.fn();

const tileborneStub = {
  jobs: { get: jobsGetMock },
  assets: { getPack: getPackMock },
};

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  jobsGetMock.mockReset();
  getPackMock.mockReset();
  removeAssetPackMutateAsyncMock.mockReset();
  removeAssetPackMutateAsyncMock.mockResolvedValue({});
  removeAssetPackMock.mockReturnValue({
    mutateAsync: removeAssetPackMutateAsyncMock,
    isPending: false,
  });
  (globalThis as { window: typeof window }).window = Object.assign(globalThis.window ?? {}, {
    tileborne: tileborneStub,
  }) as Window & typeof globalThis & { tileborne: typeof tileborneStub };
  useEditorUiStore.setState({ pendingImportJobId: null });
  useAppNotificationsStore.setState({ notifications: [] });
});

afterEach(() => {
  cleanup();
  useEditorUiStore.setState({ pendingImportJobId: null });
  useAppNotificationsStore.setState({ notifications: [] });
});

const completedJob = (packId: string) => ({
  job: { id: 'job:00000000-0000-4000-8000-000000000001', status: 'Completed', result: { packId } },
});

const packWithDuplicate = (
  packId: string,
  overrides: { existingPackId?: string; newPackId?: string; integrityHashesMatch?: boolean } = {},
) => ({
  pack: {
    id: packId,
    name: 'Duplicate Pack',
    capability: {
      packId,
      paintable: true,
      tilesetCount: 1,
      tileCount: 8,
      placeableCount: 0,
      diagnostics: [
        {
          _tag: 'PACK.duplicate-id',
          packId,
          existingPackId: overrides.existingPackId ?? packId,
          newPackId: overrides.newPackId ?? packId,
          integrityHashesMatch: overrides.integrityHashesMatch ?? false,
          message: 'Asset pack id already installed',
        },
      ],
    },
  },
});

describe('DuplicatePackDialog', () => {
  it('does not render when there is no pending import job', () => {
    render(<DuplicatePackDialog />, { wrapper });
    expect(screen.queryByTestId('duplicate-pack-dialog')).toBeNull();
  });

  it('shows Replace/Keep both prompt when duplicate-id diagnostic is present', async () => {
    jobsGetMock.mockResolvedValue(completedJob('pack-x'));
    getPackMock.mockResolvedValue(
      packWithDuplicate('pack-x', { integrityHashesMatch: true }),
    );

    render(<DuplicatePackDialog />, { wrapper });
    useEditorUiStore.setState({ pendingImportJobId: 'job:00000000-0000-4000-8000-000000000001' });

    await waitFor(() => {
      expect(screen.queryByTestId('duplicate-pack-dialog')).not.toBeNull();
    });
    expect(screen.queryByTestId('duplicate-pack-keep-both')).not.toBeNull();
    expect(screen.queryByTestId('duplicate-pack-replace')).not.toBeNull();
    expect(screen.getByText(/identical contents/)).toBeTruthy();
  });

  it('default action Keep both closes without calling removePack', async () => {
    jobsGetMock.mockResolvedValue(completedJob('pack-x'));
    getPackMock.mockResolvedValue(packWithDuplicate('pack-x'));

    render(<DuplicatePackDialog />, { wrapper });
    useEditorUiStore.setState({ pendingImportJobId: 'job:00000000-0000-4000-8000-000000000001' });

    await waitFor(() => {
      expect(screen.queryByTestId('duplicate-pack-keep-both')).not.toBeNull();
    });
    fireEvent.click(screen.getByTestId('duplicate-pack-keep-both'));

    await waitFor(() => {
      expect(screen.queryByTestId('duplicate-pack-dialog')).toBeNull();
    });
    expect(removeAssetPackMutateAsyncMock).not.toHaveBeenCalled();
    expect(useEditorUiStore.getState().pendingImportJobId).toBeNull();
  });

  it('Replace path calls removePack(existingPackId)', async () => {
    jobsGetMock.mockResolvedValue(completedJob('pack-x'));
    getPackMock.mockResolvedValue(
      packWithDuplicate('pack-x', { existingPackId: 'pack-existing' }),
    );

    render(<DuplicatePackDialog />, { wrapper });
    useEditorUiStore.setState({ pendingImportJobId: 'job:00000000-0000-4000-8000-000000000001' });

    await waitFor(() => {
      expect(screen.queryByTestId('duplicate-pack-replace')).not.toBeNull();
    });
    fireEvent.click(screen.getByTestId('duplicate-pack-replace'));

    await waitFor(() => {
      expect(removeAssetPackMutateAsyncMock).toHaveBeenCalledWith('pack-existing');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('duplicate-pack-dialog')).toBeNull();
    });
    expect(useEditorUiStore.getState().pendingImportJobId).toBeNull();
  });

  it('clears pending import job when no duplicate diagnostic is present', async () => {
    jobsGetMock.mockResolvedValue(completedJob('pack-y'));
    getPackMock.mockResolvedValue({
      pack: {
        id: 'pack-y',
        name: 'Plain Pack',
        capability: {
          packId: 'pack-y',
          paintable: true,
          tilesetCount: 1,
          tileCount: 8,
          placeableCount: 0,
          diagnostics: [],
        },
      },
    });

    render(<DuplicatePackDialog />, { wrapper });
    useEditorUiStore.setState({ pendingImportJobId: 'job:00000000-0000-4000-8000-000000000001' });

    await waitFor(() => {
      expect(useEditorUiStore.getState().pendingImportJobId).toBeNull();
    });
    expect(screen.queryByTestId('duplicate-pack-dialog')).toBeNull();
  });

  it('notifies when a tracked import job fails', async () => {
    jobsGetMock.mockResolvedValue({
      job: {
        id: 'job:00000000-0000-4000-8000-000000000001',
        status: 'Failed',
        errorMessage: 'This folder is not a Tileborne asset pack.',
      },
    });

    render(<DuplicatePackDialog />, { wrapper });
    useEditorUiStore.setState({ pendingImportJobId: 'job:00000000-0000-4000-8000-000000000001' });

    await waitFor(() => {
      expect(useEditorUiStore.getState().pendingImportJobId).toBeNull();
    });
    expect(useAppNotificationsStore.getState().notifications).toContainEqual(
      expect.objectContaining({
        kind: 'error',
        message: 'This folder is not a Tileborne asset pack.',
      }),
    );
  });
});
