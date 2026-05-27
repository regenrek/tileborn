// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/import-wizard/tiled-import-wizard', () => ({
  ImportWizard: ({
    open,
    initialSourcePath,
  }: {
    readonly open: boolean;
    readonly initialSourcePath?: string | null | undefined;
  }) =>
    open ? (
      <div data-testid="canonical-import-wizard" data-source-path={initialSourcePath ?? ''}>
        Import
      </div>
    ) : null,
}));

const setAssetImportSourcePathMock = vi.hoisted(() => vi.fn());

vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: unknown) => unknown) =>
    selector({
      assetImportSourcePath: '/drop/source.tsx',
      setAssetImportSourcePath: setAssetImportSourcePathMock,
    }),
}));

import { AssetImportDialog } from '@/components/asset-import-dialog';

describe('AssetImportDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('delegates to the canonical Import wizard', () => {
    render(<AssetImportDialog open onOpenChange={vi.fn()} projectId="project-1" />);

    const wizard = screen.getByTestId('canonical-import-wizard');
    expect(wizard).toBeTruthy();
    expect(wizard.getAttribute('data-source-path')).toBe('/drop/source.tsx');
  });
});
