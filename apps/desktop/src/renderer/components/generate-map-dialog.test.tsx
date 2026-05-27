// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mutateAsyncMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    map: { id: 'map-generated-1' },
  }),
);
const useGenerateMapMock = vi.hoisted(() =>
  vi.fn(() => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  })),
);
const useAssetPacksMock = vi.hoisted(() =>
  vi.fn(() => ({
    data: {
      packs: [
        {
          id: 'pack-1',
          name: 'Pack 1',
          capability: {
            packId: 'pack-1',
            paintable: true,
            tilesetCount: 1,
            tileCount: 8,
            placeableCount: 0,
          },
        },
      ],
    },
    refetch: vi.fn().mockResolvedValue({}),
  })),
);
const usePackCapabilitiesMock = vi.hoisted(() =>
  vi.fn(() => ({
    byId: new Map([
      [
        'pack-1',
        { packId: 'pack-1', paintable: true, tilesetCount: 1, tileCount: 8, placeableCount: 0 },
      ],
    ]),
    isLoading: false,
  })),
);
const notifyErrorMock = vi.hoisted(() => vi.fn());
const notifySuccessMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/hooks/mutations', () => ({
  useGenerateMap: useGenerateMapMock,
}));

vi.mock('@/hooks/queries', () => ({
  useAssetPacks: useAssetPacksMock,
}));

vi.mock('@/lib/pack-capability-client', () => ({
  usePackCapabilities: usePackCapabilitiesMock,
}));

vi.mock('@/stores/app-notifications-store', () => ({
  notifyError: notifyErrorMock,
  notifySuccess: notifySuccessMock,
}));

import { GenerateMapDialog } from './generate-map-dialog';

function ControlledHarness({
  projectId,
  onOpenChangeSpy,
}: {
  readonly projectId: string;
  readonly onOpenChangeSpy: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <GenerateMapDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChangeSpy(next);
        setOpen(next);
      }}
      projectId={projectId}
    />
  );
}

const renderDialog = (overrides?: { projectId?: string }) => {
  const onOpenChange = vi.fn();
  const utils = render(
    <ControlledHarness
      projectId={overrides?.projectId ?? 'project-1'}
      onOpenChangeSpy={onOpenChange}
    />,
  );
  return { ...utils, onOpenChange };
};

describe('GenerateMapDialog', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    mutateAsyncMock.mockClear();
    mutateAsyncMock.mockResolvedValue({ map: { id: 'map-generated-1' } });
    useGenerateMapMock.mockReturnValue({
      mutateAsync: mutateAsyncMock,
      isPending: false,
    });
    notifyErrorMock.mockClear();
    notifySuccessMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('closes the dialog after a successful generation', async () => {
    const { onOpenChange } = renderDialog();

    expect(screen.queryByRole('dialog')).not.toBeNull();

    fireEvent.click(screen.getByTestId('generate-map-submit'));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(notifySuccessMock).toHaveBeenCalledWith('Generated map map-generated-1');
  });

  it('closes the dialog when Cancel is clicked in the steady state', async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('closes the dialog when the X close button is clicked', async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('closes the dialog when Escape is pressed in the steady state', async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('does not close the dialog while the mutation is pending', () => {
    useGenerateMapMock.mockReturnValue({
      mutateAsync: mutateAsyncMock,
      isPending: true,
    });

    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
