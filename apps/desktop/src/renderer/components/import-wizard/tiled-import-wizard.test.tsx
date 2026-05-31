// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TiledImportPlan, TiledImportScan } from '@tileborne/sdk-tileset/tiled';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const detectImportSourceMock = vi.hoisted(() => vi.fn());
const importPackMock = vi.hoisted(() => vi.fn());
const pickImportSourceMock = vi.hoisted(() => vi.fn());
const scanMock = vi.hoisted(() => vi.fn());
const planMock = vi.hoisted(() => vi.fn());
const applyMock = vi.hoisted(() => vi.fn());
const cancelMock = vi.hoisted(() => vi.fn());
const mutationResetMock = vi.hoisted(() => vi.fn());
const setPendingImportJobIdMock = vi.hoisted(() => vi.fn());
const notifyErrorMock = vi.hoisted(() => vi.fn());
const notifySuccessMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/mutations', () => ({
  useDetectImportSource: () => ({
    mutateAsync: detectImportSourceMock,
    isPending: false,
    reset: mutationResetMock,
  }),
  useImportAssetPack: () => ({
    mutateAsync: importPackMock,
    isPending: false,
    reset: mutationResetMock,
  }),
  usePickImportSource: () => ({
    mutateAsync: pickImportSourceMock,
    isPending: false,
    reset: mutationResetMock,
  }),
  useTiledImportScan: () => ({
    mutateAsync: scanMock,
    isPending: false,
    data: undefined,
    reset: mutationResetMock,
  }),
  useTiledImportPlan: () => ({
    mutateAsync: planMock,
    isPending: false,
    data: undefined,
    reset: mutationResetMock,
  }),
  useTiledImportApply: () => ({
    mutateAsync: applyMock,
    isPending: false,
    reset: mutationResetMock,
  }),
  useTiledImportCancel: () => ({ mutate: cancelMock, isPending: false }),
}));

vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (
    selector: (state: { setPendingImportJobId: typeof setPendingImportJobIdMock }) => unknown,
  ) => selector({ setPendingImportJobId: setPendingImportJobIdMock }),
}));

vi.mock('@/stores/app-notifications-store', () => ({
  notifyError: notifyErrorMock,
  notifySuccess: notifySuccessMock,
}));

vi.mock('@/components/asset-library/library-preview-thumb', () => ({
  LibraryPreviewThumb: () => <span data-testid="mock-library-preview-thumb" />,
}));

import { ConfirmStep } from './confirm-step';
import { ImportWizard } from './tiled-import-wizard';
import { LicenseStep } from './license-step';
import { MappingReviewStep } from './mapping-review-step';
import { ScanStep } from './scan-step';

const inventory = {
  mapCount: 0,
  tilesetCount: 0,
  gridAtlasCount: 0,
  imageCollectionCount: 0,
  wangSetCount: 0,
  terrainClassCount: 0,
  animationCount: 0,
  collisionObjectCount: 0,
  objectLayerCount: 0,
  placeableCandidateCount: 0,
  unsupportedFeatureCount: 0,
} satisfies TiledImportScan['inventory'];

const featureFlags = {
  gridAtlas: false,
  imageCollection: false,
  wangSets: false,
  animations: false,
  collisionObjectgroups: false,
  templates: false,
  rotation: false,
  parallax: false,
  infiniteChunks: false,
  unsupportedOrientation: false,
  classProperties: false,
  projectFiles: false,
  flipFlags: false,
} satisfies TiledImportScan['featureFlags'];

type ScanOverrides = Omit<Partial<TiledImportScan>, 'inventory' | 'featureFlags'> & {
  readonly inventory?: Partial<TiledImportScan['inventory']>;
  readonly featureFlags?: Partial<TiledImportScan['featureFlags']>;
};

const minimalScan = (overrides: ScanOverrides = {}): TiledImportScan => {
  const { inventory: inventoryOverrides, featureFlags: featureFlagOverrides, ...rest } = overrides;
  const sourceRoles = rest.sourceRoles ?? [];
  const recommendedProfile = rest.recommendedProfile ?? 'standard';
  const importRecommendation = rest.importRecommendation ?? {
    sourceRoles,
    recommendedProfile,
    primaryAction: 'import-paintable-tilesets',
    browseTarget: 'tilesets',
    rationale: 'Test fixture import recommendation.',
    reviewRequired: false,
  };
  return {
    sourceKind: 'source-folder',
    sourcePath: '/maps',
    maps: [],
    tilesets: [],
    imageAssets: [],
    objectLayers: [],
    placeableCandidates: [],
    categories: [],
    inventory: { ...inventory, ...inventoryOverrides },
    confidence: 1,
    featureFlags: { ...featureFlags, ...featureFlagOverrides },
    unsupportedFeatures: [],
    ambiguousAtlasObjects: [],
    recommendedProfile,
    sourceRoles,
    importRecommendation,
    ...rest,
  };
};

const minimalPlan = (overrides: Partial<TiledImportPlan> = {}): TiledImportPlan => {
  const scan = overrides.scan ?? minimalScan();
  return {
    schemaVersion: 1,
    sourcePath: scan.sourcePath,
    profile: 'standard',
    scan,
    importRecommendation: scan.importRecommendation,
    mappings: {
      tilesets: [],
      categories: [],
      placeables: [],
      maps: [],
      ...overrides.mappings,
    },
    suggestions: [],
    acceptedSuggestionIds: [],
    diagnostics: [],
    ...overrides,
  };
};

describe('Tiled import wizard steps', () => {
  beforeEach(() => {
    class MockResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    Element.prototype.scrollIntoView = vi.fn();
    if (typeof Element.prototype.getAnimations !== 'function') {
      // jsdom does not implement Element.getAnimations(); Base UI's ScrollArea needs it.
      (Element.prototype as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [];
    }
    detectImportSourceMock.mockReset();
    importPackMock.mockReset();
    pickImportSourceMock.mockReset();
    scanMock.mockReset();
    planMock.mockReset();
    applyMock.mockReset();
    cancelMock.mockReset();
    mutationResetMock.mockReset();
    setPendingImportJobIdMock.mockReset();
    notifyErrorMock.mockReset();
    notifySuccessMock.mockReset();
    scanMock.mockResolvedValue({
      scan: minimalScan({
        inventory: {
          mapCount: 1,
          tilesetCount: 1,
        },
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('defaults license redistributable to false', () => {
    const onChange = vi.fn();
    render(<LicenseStep license={{ redistributable: false }} onLicenseChange={onChange} />);

    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).not.toBe('true');
  });

  it('does not accept assistive suggestions until checked', () => {
    const onAccepted = vi.fn();
    render(
      <MappingReviewStep
        scan={minimalScan()}
        plan={minimalPlan({
          suggestions: [
            {
              id: 'placeable:atlas:1',
              block: 'placeable',
              target: 'atlas:1',
              action: 'Treat atlas tile object as a placeable candidate',
              reason: 'Large object placement',
              confidence: 0.55,
              source: 'assistive-infer',
            },
          ],
        })}
        acceptedSuggestionIds={[]}
        onAcceptedSuggestionIdsChange={onAccepted}
      />,
    );

    expect(onAccepted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onAccepted).toHaveBeenCalledWith(['placeable:atlas:1']);
  });

  it('shows supported Tiled transform preservation in scan diagnostics', () => {
    render(
      <ScanStep
        scan={minimalScan({ featureFlags: { flipFlags: true } })}
        diagnostics={[]}
        pending={false}
      />,
    );

    expect(screen.getByText('Tiled transforms preserved')).toBeTruthy();
    expect(screen.getByText('No blocking diagnostics')).toBeTruthy();
  });

  it('shows actionable unsupported Tiled feature diagnostics', () => {
    render(
      <ScanStep
        scan={minimalScan({
          inventory: { unsupportedFeatureCount: 1 },
          featureFlags: { classProperties: true },
          unsupportedFeatures: [
            {
              feature: 'class-properties',
              path: '/properties/0',
              message: 'Tiled class-typed custom properties require Tiled project class definitions and are not imported.',
              action: 'Flatten class properties to primitive string, number, or boolean properties before importing.',
            },
          ],
        })}
        diagnostics={[]}
        pending={false}
      />,
    );

    expect(screen.getByText('class-properties')).toBeTruthy();
    expect(
      screen.getByText('Flatten class properties to primitive string, number, or boolean properties before importing.'),
    ).toBeTruthy();
  });

  it('shows typed unsupported zstd compression diagnostics from import-center analysis', () => {
    render(
      <ScanStep
        scan={minimalScan()}
        diagnostics={[
          {
            _tag: 'TiledUnsupportedCompression',
            severity: 'warning',
            path: '/layers/ground/data',
            message: 'Layer uses unsupported compression "zstd"',
            action: 'Re-export the Tiled layer as raw, CSV, base64, gzip, or zlib.',
          },
        ]}
        pending={false}
      />,
    );

    expect(screen.getByText('TiledUnsupportedCompression')).toBeTruthy();
    expect(screen.getByText('Layer uses unsupported compression "zstd"')).toBeTruthy();
    expect(
      screen.getByText('Re-export the Tiled layer as raw, CSV, base64, gzip, or zlib.'),
    ).toBeTruthy();
  });

  it('routes a Tileborne pack folder from source detection into License', async () => {
    detectImportSourceMock.mockResolvedValue({
      detection: {
        kind: 'tileborne-pack',
        path: '/packs/forest',
        detectedTypes: ['Tileborne pack manifest'],
        hasTileborneManifest: true,
        tiledMapCount: 0,
        tiledTilesetCount: 0,
        preferredKind: 'tileborne-pack',
        message: 'Detected a Tileborne asset pack.',
      },
    });

    render(<ImportWizard open onOpenChange={vi.fn()} projectId="project-1" />);

    fireEvent.change(screen.getByLabelText('Import source path'), {
      target: { value: '/packs/forest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByText('License and provenance')).toBeTruthy();
    });
    expect(scanMock).not.toHaveBeenCalled();
  });

  it('resets to the source step after cancel and reopen while mounted', async () => {
    detectImportSourceMock.mockResolvedValue({
      detection: {
        kind: 'tileborne-pack',
        path: '/packs/forest',
        detectedTypes: ['Tileborne pack manifest'],
        hasTileborneManifest: true,
        tiledMapCount: 0,
        tiledTilesetCount: 0,
        preferredKind: 'tileborne-pack',
        message: 'Detected a Tileborne asset pack.',
      },
    });
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ImportWizard open onOpenChange={onOpenChange} projectId="project-1" />,
    );

    fireEvent.change(screen.getByLabelText('Import source path'), {
      target: { value: '/packs/forest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(screen.getByText('License and provenance')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(<ImportWizard open={false} onOpenChange={onOpenChange} projectId="project-1" />);
    rerender(<ImportWizard open onOpenChange={onOpenChange} projectId="project-1" />);

    expect(
      screen.getByText(
        'Step 1 of 8: analyze, review, and apply Tileborne or Tiled source content.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Import source path')).toHaveProperty('value', '');
  });

  it('uses the file-or-folder import source picker', async () => {
    pickImportSourceMock.mockResolvedValue({ path: '/maps/forest.tmx' });

    render(<ImportWizard open onOpenChange={vi.fn()} projectId="project-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));

    await waitFor(() => {
      expect(pickImportSourceMock).toHaveBeenCalledWith();
    });
    expect(screen.getByLabelText('Import source path')).toHaveProperty('value', '/maps/forest.tmx');
  });

  it('routes a Tiled source folder into scan', async () => {
    detectImportSourceMock.mockResolvedValue({
      detection: {
        kind: 'tiled-source',
        path: '/maps/forest',
        detectedTypes: ['Tiled source files'],
        hasTileborneManifest: false,
        tiledMapCount: 1,
        tiledTilesetCount: 1,
        preferredKind: 'tiled-source',
        message: 'Detected raw Tiled source files.',
      },
    });

    render(<ImportWizard open onOpenChange={vi.fn()} projectId="project-1" />);

    fireEvent.change(screen.getByLabelText('Import source path'), {
      target: { value: '/maps/forest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(scanMock).toHaveBeenCalledWith({
        projectId: 'project-1',
        sourcePath: '/maps/forest',
      });
    });
    expect(screen.getByText('Analysis inventory')).toBeTruthy();
  });

  it('uses the SDK import recommendation for the default profile and preserves expert override', async () => {
    detectImportSourceMock.mockResolvedValue({
      detection: {
        kind: 'tiled-source',
        path: '/maps/props',
        detectedTypes: ['Tiled source files'],
        hasTileborneManifest: false,
        tiledMapCount: 0,
        tiledTilesetCount: 1,
        preferredKind: 'tiled-source',
        message: 'Detected raw Tiled source files.',
      },
    });
    scanMock.mockResolvedValue({
      scan: minimalScan({
        sourceRoles: [
          {
            kind: 'placeable-object',
            evidence: 'tileborne-placeable-hint',
            confidence: 0.92,
            count: 3,
            tilesetName: 'Props',
            browseTarget: 'objects',
            reviewRequired: false,
            rationale: 'Tileborne placeable hints were detected.',
          },
        ],
        recommendedProfile: 'assistive-infer',
        importRecommendation: {
          sourceRoles: [
            {
              kind: 'placeable-object',
              evidence: 'tileborne-placeable-hint',
              confidence: 0.92,
              count: 3,
              tilesetName: 'Props',
              browseTarget: 'objects',
              reviewRequired: false,
              rationale: 'Tileborne placeable hints were detected.',
            },
          ],
          recommendedProfile: 'assistive-infer',
          primaryAction: 'import-placeable-objects',
          browseTarget: 'objects',
          rationale: 'Import as placeable objects because explicit hints were detected.',
          reviewRequired: false,
        },
      }),
    });

    render(<ImportWizard open onOpenChange={vi.fn()} projectId="project-1" />);

    fireEvent.change(screen.getByLabelText('Import source path'), {
      target: { value: '/maps/props' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByTestId('import-center-recommendation')).toBeTruthy();
    });
    expect(
      screen.getByText('Import as placeable objects because explicit hints were detected.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Use recommendation' }));

    await waitFor(() => {
      expect(screen.getByTestId('import-profile-recommendation')).toBeTruthy();
    });
    expect(
      screen.getByRole('radio', { name: 'Assistive Infer' }).getAttribute('aria-checked'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Standard' }));
    expect(screen.getByText('Expert override active.')).toBeTruthy();

    planMock.mockResolvedValue({ plan: minimalPlan() });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(planMock).toHaveBeenCalledWith({
        projectId: 'project-1',
        sourcePath: '/maps/props',
        profile: 'standard',
        hints: { acceptedSuggestionIds: [] },
      });
    });
  });

  it('routes standalone Tiled tileset files into scan', async () => {
    detectImportSourceMock.mockResolvedValue({
      detection: {
        kind: 'tiled-source',
        path: '/maps/Atlas-Props-Sprites.tsx',
        detectedTypes: ['Tiled tileset file'],
        hasTileborneManifest: false,
        tiledMapCount: 0,
        tiledTilesetCount: 1,
        preferredKind: 'tiled-source',
        message: 'Detected a standalone Tiled tileset file.',
      },
    });

    render(<ImportWizard open onOpenChange={vi.fn()} projectId="project-1" />);

    fireEvent.change(screen.getByLabelText('Import source path'), {
      target: { value: '/maps/Atlas-Props-Sprites.tsx' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(scanMock).toHaveBeenCalledWith({
        projectId: 'project-1',
        sourcePath: '/maps/Atlas-Props-Sprites.tsx',
      });
    });
    expect(screen.getByText('Analysis inventory')).toBeTruthy();
  });

  it('surfaces ambiguous detection before confirming the preferred route', async () => {
    detectImportSourceMock.mockResolvedValue({
      detection: {
        kind: 'ambiguous',
        path: '/mixed/source',
        detectedTypes: ['Tileborne pack manifest', 'Tiled source files'],
        hasTileborneManifest: true,
        tiledMapCount: 1,
        tiledTilesetCount: 0,
        preferredKind: 'tileborne-pack',
        message: 'This folder contains both import types.',
      },
    });

    render(<ImportWizard open onOpenChange={vi.fn()} projectId="project-1" />);

    fireEvent.change(screen.getByLabelText('Import source path'), {
      target: { value: '/mixed/source' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByTestId('import-source-detection')).toBeTruthy();
    });
    expect(screen.getByText('Ambiguous import source')).toBeTruthy();
    expect(scanMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(screen.getByText('License and provenance')).toBeTruthy();
    });
  });

  it('renders all populated Mapping Review tabs with counts and confidence badges', () => {
    render(
      <MappingReviewStep
        scan={minimalScan({
          tilesets: [
            {
              name: 'terrain',
              firstgid: 1,
              kind: 'grid',
              tileCount: 64,
              columns: 8,
              wangSetCount: 2,
              terrainClassCount: 3,
              animationCount: 4,
              collisionObjectCount: 5,
              categories: ['ground'],
              confidence: 0.91,
            },
          ],
          categories: [
            { id: 'ground', label: 'Ground', source: 'type', count: 8, confidence: 0.9 },
          ],
          objectLayers: [
            {
              name: 'Objects',
              objectCount: 3,
              gidObjectCount: 2,
              categories: ['ground'],
              confidence: 0.82,
            },
          ],
        })}
        plan={minimalPlan({
          mappings: {
            tilesets: [
              {
                name: 'terrain',
                kind: 'grid',
                categoryIds: ['ground'],
                paintable: true,
                placeable: false,
                confidence: 0.91,
              },
            ],
            categories: [
              { id: 'ground', label: 'Ground', source: 'type', count: 8, confidence: 0.9 },
            ],
            placeables: [
              {
                tilesetName: 'props',
                localTileId: 1,
                source: 'tileborne-hint',
                width: 16,
                height: 16,
                category: 'decor',
                confidence: 0.73,
              },
            ],
            maps: [],
          },
          suggestions: [
            {
              id: 'placeable:1',
              block: 'placeable',
              target: 'props:1',
              action: 'Treat prop as placeable',
              reason: 'Large object placement',
              confidence: 0.64,
              source: 'assistive-infer',
            },
          ],
        })}
        acceptedSuggestionIds={[]}
        onAcceptedSuggestionIdsChange={vi.fn()}
      />,
    );

    for (const label of [
      'Tilesets',
      'Wang/Autotiles',
      'Terrain',
      'Placeables',
      'Object Classes',
      'Categories',
      'Animations',
      'Collisions',
      'Suggestions',
    ]) {
      expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeTruthy();
    }
    expect(screen.getAllByText('Confidence 91%').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /Suggestions/ }));
    expect(screen.getByText('Confidence 64%')).toBeTruthy();
  });

  it('uses a Combobox SPDX picker and accepts a custom value', async () => {
    const onChange = vi.fn();
    render(<LicenseStep license={{ redistributable: false }} onLicenseChange={onChange} />);

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.change(screen.getByPlaceholderText('Search or enter a custom SPDX id'), {
      target: { value: 'GPL-3.0-only' },
    });
    fireEvent.click(await screen.findByText('GPL-3.0-only'));

    expect(onChange).toHaveBeenCalledWith({ redistributable: false, id: 'GPL-3.0-only' });
  });

  it('renders Working Palette preview cards on Confirm', () => {
    render(
      <ConfirmStep
        scan={minimalScan({
          inventory: {
            mapCount: 1,
            tilesetCount: 1,
            gridAtlasCount: 1,
            imageCollectionCount: 0,
            wangSetCount: 1,
            terrainClassCount: 1,
            animationCount: 0,
            collisionObjectCount: 0,
            objectLayerCount: 0,
            placeableCandidateCount: 1,
            unsupportedFeatureCount: 0,
          },
          sourcePath: '/maps/forest.tmj',
          tilesets: [
            {
              name: 'terrain',
              firstgid: 1,
              kind: 'grid',
              tileCount: 64,
              columns: 8,
              wangSetCount: 1,
              terrainClassCount: 1,
              animationCount: 0,
              collisionObjectCount: 0,
              categories: ['Tree'],
              confidence: 0.9,
            },
          ],
        })}
        plan={minimalPlan({
          sourcePath: '/maps/forest.tmj',
          mappings: {
            tilesets: [],
            categories: [],
            placeables: [
              {
                tilesetName: 'props',
                localTileId: 2,
                source: 'tileborne-hint',
                image: 'props/tree.png',
                width: 16,
                height: 16,
                category: 'Tree',
                confidence: 0.8,
              },
            ],
            maps: [],
          },
        })}
        license={{ redistributable: false }}
      />,
    );

    expect(screen.getByText('Working Palette preview')).toBeTruthy();
    expect(screen.getAllByText('terrain').length).toBeGreaterThan(0);
    expect(screen.getByText('Tree')).toBeTruthy();
    expect(screen.getByTestId('mock-library-preview-thumb')).toBeTruthy();
  });
});
