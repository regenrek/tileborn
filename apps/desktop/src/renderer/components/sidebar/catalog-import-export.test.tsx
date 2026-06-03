// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/app-notifications-store', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

import { CatalogImportExport } from '@/components/sidebar/catalog-import-export';
import { queryKeys } from '@/lib/query-client';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

const PROJECT_ID = 'project:550e8400-e29b-41d4-a716-446655440101';

const importFn = vi.fn();
const exportFn = vi.fn();
const clickSpy = vi.fn();

const installBridge = () => {
  Object.defineProperty(window, 'tileborne', {
    configurable: true,
    value: { catalog: { import: importFn, export: exportFn } },
  });
};

const selectImportFile = (json: string) => {
  const input = screen.getByTestId('catalog-import-file-input') as HTMLInputElement;
  const file = new File([json], 'fragment.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
};

describe('CatalogImportExport', () => {
  let client: QueryClient;

  beforeEach(() => {
    importFn.mockReset();
    exportFn.mockReset();
    clickSpy.mockReset();
    vi.mocked(notifySuccess).mockReset();
    vi.mocked(notifyError).mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    installBridge();
    // jsdom does not implement object URLs or anchor downloads.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickSpy);
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  it('disables the controls when no project is open', () => {
    render(<CatalogImportExport projectId={undefined} />, { wrapper });
    expect((screen.getByTestId('catalog-export-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('catalog-import-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('exports the project fragment and saves it as a JSON file', async () => {
    exportFn.mockResolvedValue({ catalogJson: { id: 'catalog:abc', objectTypes: [] } });
    render(<CatalogImportExport projectId={PROJECT_ID} />, { wrapper });

    fireEvent.click(screen.getByTestId('catalog-export-button'));

    await waitFor(() => expect(exportFn).toHaveBeenCalledWith({ projectId: PROJECT_ID }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(notifySuccess).toHaveBeenCalled();
  });

  it('surfaces an approval confirmation before importing a picked fragment', async () => {
    importFn.mockResolvedValue({ imported: true, report: { ok: true, issues: [] } });
    render(<CatalogImportExport projectId={PROJECT_ID} />, { wrapper });

    selectImportFile(JSON.stringify({ id: 'catalog:abc', schemaVersion: 1, objectTypes: [] }));

    // The approval dialog is shown; nothing is imported until the user confirms.
    await screen.findByTestId('catalog-import-dialog');
    expect(importFn).not.toHaveBeenCalled();
  });

  it('imports on confirmation and invalidates the resolve query so palette/inspector refresh', async () => {
    importFn.mockResolvedValue({ imported: true, report: { ok: true, issues: [] } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(<CatalogImportExport projectId={PROJECT_ID} />, { wrapper });

    selectImportFile(JSON.stringify({ id: 'catalog:abc', schemaVersion: 1, objectTypes: [] }));
    await screen.findByTestId('catalog-import-dialog');
    fireEvent.click(screen.getByTestId('catalog-import-confirm'));

    await waitFor(() =>
      expect(importFn).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        catalogJson: { id: 'catalog:abc', schemaVersion: 1, objectTypes: [] },
      }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.catalog.resolve(PROJECT_ID),
      }),
    );
    expect(notifySuccess).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('catalog-import-dialog')).toBeNull());
  });

  it('shows the validation report and does not persist/refresh on a validation failure', async () => {
    importFn.mockResolvedValue({
      imported: false,
      report: {
        ok: false,
        issues: [
          { kind: 'duplicate-type', message: 'Duplicate object type my-crate' },
          { kind: 'unknown-reference', message: 'Unknown loot table referenced' },
        ],
      },
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(<CatalogImportExport projectId={PROJECT_ID} />, { wrapper });

    selectImportFile(JSON.stringify({ id: 'catalog:abc', schemaVersion: 1, objectTypes: [] }));
    await screen.findByTestId('catalog-import-dialog');
    fireEvent.click(screen.getByTestId('catalog-import-confirm'));

    const report = await screen.findByTestId('catalog-import-report');
    expect(report.textContent).toContain('Duplicate object type my-crate');
    expect(report.textContent).toContain('Unknown loot table referenced');
    expect(screen.getAllByTestId('catalog-import-issue')).toHaveLength(2);
    // Validation failure: the resolve query is never invalidated (nothing persisted).
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('catalog-import-dialog')).toBeTruthy();
  });

  it('rejects a non-JSON file without opening the approval dialog', async () => {
    render(<CatalogImportExport projectId={PROJECT_ID} />, { wrapper });

    selectImportFile('this is not json');

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(screen.queryByTestId('catalog-import-dialog')).toBeNull();
    expect(importFn).not.toHaveBeenCalled();
  });
});
