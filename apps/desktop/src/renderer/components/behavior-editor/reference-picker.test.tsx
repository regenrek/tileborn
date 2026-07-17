// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeAssetId, type Uuid } from '@tileborne/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BehaviorReferencePicker } from './invocation-editor.js';

const uuid = (index: number): Uuid =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` as Uuid;

afterEach(() => vi.restoreAllMocks());

describe('BehaviorReferencePicker', () => {
  it('loads only when opened and virtualizes a bounded page from a 2,000+ result set', async () => {
    const references = vi.fn().mockResolvedValue({
      kind: 'asset',
      query: '',
      offset: 0,
      limit: 32,
      total: 2_050,
      options: Array.from({ length: 32 }, (_, index) => {
        const assetId = makeAssetId(uuid(index + 1));
        return {
          id: String(assetId),
          label: `Asset ${index + 1}`,
          reference: { _tag: 'asset' as const, assetId },
        };
      }),
    });
    Object.assign(globalThis.window, { tileborne: { behaviors: { references } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onPick = vi.fn();
    const view = render(
      <QueryClientProvider client={client}>
        <BehaviorReferencePicker
          open={false}
          projectId="project-1"
          kind="asset"
          onOpenChange={vi.fn()}
          onPick={onPick}
        />
      </QueryClientProvider>,
    );

    expect(references).not.toHaveBeenCalled();
    view.rerender(
      <QueryClientProvider client={client}>
        <BehaviorReferencePicker
          open
          projectId="project-1"
          kind="asset"
          onOpenChange={vi.fn()}
          onPick={onPick}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(references).toHaveBeenCalledTimes(1));
    await screen.findByText('1–32 of 2050');
    const mountedOptions = screen.getAllByRole('option');
    expect(mountedOptions.length).toBeGreaterThan(0);
    expect(mountedOptions.length).toBeLessThan(32);
    fireEvent.click(mountedOptions[0]!);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ label: 'Asset 1' }));
    expect(screen.getByTestId('behavior-reference-virtual-list')).toBeTruthy();
    client.clear();
  });
});
