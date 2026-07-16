import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  BehaviorInvocation,
  BehaviorRegistryEntry,
  BehaviorStateField,
  EntityBehaviorReference,
  ReferenceBehaviorValue,
  CORE_BEHAVIOR_REGISTRY,
  CORE_BEHAVIOR_TEMPLATES,
} from '@tileborne/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BehaviorConversionWarning,
  behaviorEditorShortcut,
  BehaviorResourceList,
  focusBehaviorSourceNavigation,
  TypeScriptBehaviorDocument,
} from './behavior-editor-page';
import { BehaviorEventSheet } from './event-sheet';
import { instantiateBehaviorTemplate } from './model';

describe('BehaviorEventSheet', () => {
  beforeEach(cleanup);
  it('authors searchable typed actions and nested IF/THEN/ELSE with accessible controls', () => {
    const initial = instantiateBehaviorTemplate(CORE_BEHAVIOR_TEMPLATES[0]!, CORE_BEHAVIOR_REGISTRY);
    let draft = initial;
    const onChange = vi.fn((next) => { draft = next; });
    const { rerender } = render(
      <BehaviorEventSheet draft={draft} entries={CORE_BEHAVIOR_REGISTRY.entries} references={{}} issues={[]} onChange={onChange} />,
    );

    expect(screen.getByRole('heading', { name: 'Trigger' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Conditions' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Actions in order' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    rerender(<BehaviorEventSheet draft={draft} entries={CORE_BEHAVIOR_REGISTRY.entries} references={{}} issues={[]} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Choose condition block' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add branch' }));
    rerender(<BehaviorEventSheet draft={draft} entries={CORE_BEHAVIOR_REGISTRY.entries} references={{}} issues={[]} onChange={onChange} />);
    expect(screen.getByText('THEN')).toBeTruthy();
    expect(screen.getByText('ELSE')).toBeTruthy();

    const thenGroup = screen.getByRole('group', { name: 'Then actions' });
    fireEvent.click(within(thenGroup).getByRole('button', { name: 'Add action' }));
    const picker = screen.getByTestId('behavior-action-picker');
    fireEvent.change(within(picker).getByRole('textbox', { name: 'Search action blocks' }), { target: { value: 'repeating' } });
    fireEvent.click(within(picker).getByRole('option', { name: /Start repeating timer/ }));
    rerender(<BehaviorEventSheet draft={draft} entries={CORE_BEHAVIOR_REGISTRY.entries} references={{}} issues={[]} onChange={onChange} />);
    expect(screen.getByText('Start repeating timer')).toBeTruthy();
    expect((screen.getByRole('spinbutton', { name: 'Ticks' }) as HTMLInputElement).value).toBe('60');
    expect(screen.getAllByRole('button', { name: 'Move action up' }).every((button) => button.hasAttribute('disabled'))).toBe(true);
  });

  it('virtualizes large behavior lists instead of mounting every resource row', () => {
    const resources = Array.from({ length: 2_000 }, (_, index) => ({
      kind: 'visual' as const,
      manifest: { id: `behavior-${index}`, label: `Behavior ${index}` },
      definition: {},
    })) as never;
    const onSelect = vi.fn();
    render(
      <BehaviorResourceList resources={resources} selectedId="behavior-0" query="" onQueryChange={vi.fn()} onSelect={onSelect} onCreate={vi.fn()} />,
    );
    const list = screen.getByTestId('behavior-virtual-list');
    expect(list.getAttribute('role')).toBe('listbox');
    expect(within(list).queryAllByRole('option').length).toBeLessThan(40);
    expect(list.firstElementChild?.getAttribute('style')).toContain('height: 104000px');
    const first = within(list).getByRole('option', { name: /Behavior 0/ });
    expect(first.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('behavior-1');
  });

  it('shows converted TypeScript as the sole canonical source without a reverse conversion claim', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><TypeScriptBehaviorDocument projectId={'project:77777777-7777-4777-8777-777777777777' as never} revision={2} onSaved={vi.fn()} resource={{
      kind: 'typescript',
      manifest: {
        id: 'behavior:77777777-7777-4777-8777-777777777777',
        label: 'Converted door',
        source: {
          _tag: 'typescript',
          sourcePath: 'behaviors/sources/77777777-7777-4777-8777-777777777777.ts',
          exportName: 'default',
        },
        requiredCapabilities: [],
      },
      source: `import { defineBehavior } from '@tileborne/game-sdk';`,
    } as never} /></QueryClientProvider>);
    expect(screen.getByText('TypeScript · canonical')).toBeTruthy();
    expect(screen.getByText('behaviors/sources/77777777-7777-4777-8777-777777777777.ts')).toBeTruthy();
    expect((screen.getByLabelText('TypeScript behavior source') as HTMLTextAreaElement).value).toContain('defineBehavior');
    expect(screen.getByText(/Conversion back to visual blocks is intentionally unavailable/)).toBeTruthy();
    client.clear();
  });

  it('renders an explicit irreversible conversion warning before the canonical source switch', () => {
    render(<BehaviorConversionWarning />);
    expect(screen.getByText(/one-way eject/i)).toBeTruthy();
    expect(screen.getByText(/cannot be converted back into visual blocks/i)).toBeTruthy();
    expect(screen.getByText(/saved visual event sheet will be removed/i)).toBeTruthy();
  });

  it('focuses exact visual nodes and TypeScript diagnostic carets', () => {
    const scrollIntoView = vi.fn();
    const { unmount } = render(<button data-node-id="node-bad" ref={(node) => {
      if (node !== null) node.scrollIntoView = scrollIntoView;
    }}>Bad node</button>);
    expect(focusBehaviorSourceNavigation({
      projectId: 'project:a', behaviorId: 'behavior:a', nodeId: 'node-bad',
    })).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bad node' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    unmount();

    render(<textarea aria-label="TypeScript behavior source" defaultValue={'first\nsecond line\nthird'} />);
    expect(focusBehaviorSourceNavigation({
      projectId: 'project:a', behaviorId: 'behavior:a', sourcePath: 'behaviors/a.ts', line: 2, column: 4,
    })).toBe(true);
    const source = screen.getByLabelText('TypeScript behavior source') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(source);
    expect(source.selectionStart).toBe(9);
    expect(source.selectionEnd).toBe(9);
  });

  it('associates problems with the exact field and focuses it from the summary', () => {
    const initial = instantiateBehaviorTemplate(CORE_BEHAVIOR_TEMPLATES[0]!, CORE_BEHAVIOR_REGISTRY);
    const draft = {
      ...initial,
      label: '',
      state: [new BehaviorStateField({ key: 'bad key', label: 'Bad key', initialValue: null })],
    };
    const issues = [
      { path: 'label', message: 'Behavior name is required' },
      { path: 'state.0.key', message: 'State key is invalid' },
    ];
    render(<BehaviorEventSheet draft={draft} entries={CORE_BEHAVIOR_REGISTRY.entries} references={{}} issues={issues} onChange={vi.fn()} />);
    const label = document.getElementById('behavior-label')!;
    const stateKey = screen.getByRole('textbox', { name: 'State key' });
    expect(label.getAttribute('aria-invalid')).toBe('true');
    expect(stateKey.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'State key is invalid' }));
    expect(document.activeElement).toBe(stateKey);
  });

  it('maps platform save, undo and redo shortcuts deterministically', () => {
    const event = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...overrides });
    expect(behaviorEditorShortcut(event('s'))).toBe('save');
    expect(behaviorEditorShortcut(event('z'))).toBe('undo');
    expect(behaviorEditorShortcut(event('z', { shiftKey: true }))).toBe('redo');
    expect(behaviorEditorShortcut(event('y'))).toBe('redo');
    expect(behaviorEditorShortcut(event('z', { altKey: true }))).toBeUndefined();
  });

  it('keeps optional references unset until explicitly selected and lets users clear them', () => {
    const optionalEvent = new BehaviorRegistryEntry({
      id: 'battle-royale.player-eliminated' as never,
      kind: 'event',
      label: 'Player eliminated',
      category: 'Battle Royale',
      description: 'Runs for any player unless one is selected.',
      capability: 'battle-royale.match' as never,
      inputs: [{ key: 'player', label: 'Player', valueKind: 'entity-reference', required: false }],
      outputs: [],
    });
    const objectId = 'object:00000000-0000-4000-8000-000000000077' as never;
    let draft = {
      ...instantiateBehaviorTemplate(CORE_BEHAVIOR_TEMPLATES[0]!, CORE_BEHAVIOR_REGISTRY),
      when: new BehaviorInvocation({ entryId: optionalEvent.id, arguments: {} }),
    };
    const references = { entity: [{ id: objectId, label: 'Arena player', reference: new EntityBehaviorReference({ objectId }) }] };
    const onChange = vi.fn((next) => { draft = next; });
    const view = render(<BehaviorEventSheet draft={draft} entries={[...CORE_BEHAVIOR_REGISTRY.entries, optionalEvent]} references={references} issues={[]} onChange={onChange} />);
    expect((screen.getByRole('combobox', { name: 'Player source' }) as HTMLSelectElement).value).toBe('unset');
    expect(screen.getByText('Matches any player')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Player source' }), { target: { value: 'reference' } });
    view.rerender(<BehaviorEventSheet draft={draft} entries={[...CORE_BEHAVIOR_REGISTRY.entries, optionalEvent]} references={references} issues={[]} onChange={onChange} />);
    expect(draft.when.arguments.player).toMatchObject({ _tag: 'reference', reference: { objectId } });

    fireEvent.change(screen.getByRole('combobox', { name: 'Player source' }), { target: { value: 'unset' } });
    expect(draft.when.arguments.player).toBeUndefined();
  });

  it('shows the cached label and preview for a selected on-demand reference', () => {
    const optionalEvent = new BehaviorRegistryEntry({
      id: 'battle-royale.player-eliminated' as never,
      kind: 'event',
      label: 'Player eliminated',
      category: 'Battle Royale',
      description: 'Runs for one selected player.',
      capability: 'battle-royale.match' as never,
      inputs: [{ key: 'player', label: 'Player', valueKind: 'entity-reference', required: true }],
      outputs: [],
    });
    const objectId = 'object:00000000-0000-4000-8000-000000000077' as never;
    const reference = new EntityBehaviorReference({ objectId });
    const draft = {
      ...instantiateBehaviorTemplate(CORE_BEHAVIOR_TEMPLATES[0]!, CORE_BEHAVIOR_REGISTRY),
      when: new BehaviorInvocation({
        entryId: optionalEvent.id,
        arguments: { player: new ReferenceBehaviorValue({ reference }) },
      }),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <BehaviorEventSheet
          draft={draft}
          entries={[...CORE_BEHAVIOR_REGISTRY.entries, optionalEvent]}
          references={{ entity: [{ id: objectId, label: 'Arena player', previewUrl: 'data:image/png;base64,AA==', reference }] }}
          projectId="project-1"
          issues={[]}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Arena player')).toBeTruthy();
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
    client.clear();
  });
});
