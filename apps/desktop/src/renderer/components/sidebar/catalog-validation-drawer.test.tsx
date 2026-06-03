// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useValidateCatalogMock = vi.hoisted(() => vi.fn());
const useMapMock = vi.hoisted(() => vi.fn());
const useResolvedCatalogMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/queries', () => ({
  useValidateCatalog: useValidateCatalogMock,
  useMap: useMapMock,
  useResolvedCatalog: useResolvedCatalogMock,
}));

import { CatalogValidationDrawer } from '@/components/sidebar/catalog-validation-drawer';
import { useEditorUiStore } from '@/stores/editor-ui-store';

const PROJECT_ID = 'project:550e8400-e29b-41d4-a716-446655440101';
const MAP_ID = 'map:550e8400-e29b-41d4-a716-446655440201';
const TYPE_PLACED = 'gameObjectType:placed';
const TYPE_UNPLACED = 'gameObjectType:unplaced';

const setReport = (report: unknown, options: { isLoading?: boolean; isError?: boolean } = {}) => {
  useValidateCatalogMock.mockReturnValue({
    data: report === undefined ? undefined : { report },
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
  });
};

describe('CatalogValidationDrawer', () => {
  beforeEach(() => {
    useValidateCatalogMock.mockReset();
    useMapMock.mockReset();
    useResolvedCatalogMock.mockReset();
    setReport(undefined, { isLoading: true });
    useMapMock.mockReturnValue({ data: undefined });
    useResolvedCatalogMock.mockReturnValue({ data: { objectTypes: [], lootTables: [], items: [] } });
    useEditorUiStore.setState({
      selection: new Set(),
      activeTool: 'select',
      brushIntent: { kind: 'eraser' },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('disables the trigger when no project is open', () => {
    render(<CatalogValidationDrawer projectId={undefined} />);
    expect((screen.getByTestId('catalog-validation-trigger') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reflects a clean report with an OK badge', () => {
    setReport({ ok: true, issues: [] });
    render(<CatalogValidationDrawer projectId={PROJECT_ID} mapId={MAP_ID} />);
    const trigger = screen.getByTestId('catalog-validation-trigger');
    expect(trigger.getAttribute('data-state')).toBe('ok');
    expect(screen.getByTestId('catalog-validation-badge-ok')).toBeTruthy();
  });

  it('reflects an issue count and lists issues grouped by kind in the drawer', async () => {
    setReport({
      ok: false,
      issues: [
        { kind: 'coherence', message: 'soft coherence note' },
        { kind: 'duplicate-type', message: 'duplicate crate', objectTypeId: TYPE_UNPLACED },
        { kind: 'unknown-reference', message: 'missing loot table', objectTypeId: TYPE_PLACED },
      ],
    });
    render(<CatalogValidationDrawer projectId={PROJECT_ID} mapId={MAP_ID} />);

    expect(screen.getByTestId('catalog-validation-badge-count').textContent).toBe('3');

    fireEvent.click(screen.getByTestId('catalog-validation-trigger'));

    await screen.findByTestId('catalog-validation-drawer');
    expect(screen.getByTestId('catalog-validation-group-duplicate-type')).toBeTruthy();
    expect(screen.getByTestId('catalog-validation-group-unknown-reference')).toBeTruthy();
    expect(screen.getByTestId('catalog-validation-group-coherence')).toBeTruthy();
    expect(screen.getAllByTestId('catalog-validation-issue')).toHaveLength(3);
  });

  it('navigates to a placed object of the referenced type by selecting it', async () => {
    setReport({
      ok: false,
      issues: [{ kind: 'unknown-reference', message: 'missing loot table', objectTypeId: TYPE_PLACED }],
    });
    useMapMock.mockReturnValue({
      data: {
        map: {
          objects: [
            { id: 'object:other', kind: TYPE_UNPLACED },
            { id: 'object:match', kind: TYPE_PLACED },
          ],
        },
      },
    });
    render(<CatalogValidationDrawer projectId={PROJECT_ID} mapId={MAP_ID} />);

    fireEvent.click(screen.getByTestId('catalog-validation-trigger'));
    await screen.findByTestId('catalog-validation-drawer');
    fireEvent.click(screen.getByTestId('catalog-validation-issue-button'));

    expect([...useEditorUiStore.getState().selection]).toEqual(['object:match']);
    expect(useEditorUiStore.getState().activeTool).toBe('select');
    await waitFor(() => expect(screen.queryByTestId('catalog-validation-drawer')).toBeNull());
  });

  it('surfaces an unplaced referenced type as the active catalog-object brush', async () => {
    setReport({
      ok: false,
      issues: [{ kind: 'duplicate-type', message: 'duplicate crate', objectTypeId: TYPE_UNPLACED }],
    });
    useMapMock.mockReturnValue({ data: { map: { objects: [] } } });
    useResolvedCatalogMock.mockReturnValue({
      data: {
        objectTypes: [{ objectType: { id: TYPE_UNPLACED, label: 'Loot Crate' }, origin: 'project' }],
        lootTables: [],
        items: [],
      },
    });
    render(<CatalogValidationDrawer projectId={PROJECT_ID} mapId={MAP_ID} />);

    fireEvent.click(screen.getByTestId('catalog-validation-trigger'));
    await screen.findByTestId('catalog-validation-drawer');
    fireEvent.click(screen.getByTestId('catalog-validation-issue-button'));

    expect(useEditorUiStore.getState().brushIntent).toMatchObject({
      kind: 'plugin-object',
      objectKind: TYPE_UNPLACED,
      label: 'Loot Crate',
    });
    expect(useEditorUiStore.getState().activeTool).toBe('objectPlace');
  });

  it('renders a non-navigable issue (no object type id) as static text', async () => {
    setReport({ ok: false, issues: [{ kind: 'coherence', message: 'bare coherence note' }] });
    render(<CatalogValidationDrawer projectId={PROJECT_ID} mapId={MAP_ID} />);

    fireEvent.click(screen.getByTestId('catalog-validation-trigger'));
    await screen.findByTestId('catalog-validation-drawer');
    expect(screen.getByTestId('catalog-validation-issue')).toBeTruthy();
    expect(screen.queryByTestId('catalog-validation-issue-button')).toBeNull();
  });
});
