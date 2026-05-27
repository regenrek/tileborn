// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useFocusSearchShortcut } from '@/hooks/use-focus-search-shortcut';

function SearchField({ label }: { readonly label: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useFocusSearchShortcut(inputRef);

  return <input ref={inputRef} aria-label={label} />;
}

describe('useFocusSearchShortcut', () => {
  afterEach(() => {
    cleanup();
  });

  it('focuses the search input when / is pressed', () => {
    render(<SearchField label="Search asset packs" />);
    const input = screen.getByLabelText('Search asset packs');

    expect(document.activeElement).not.toBe(input);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));

    expect(document.activeElement).toBe(input);
  });

  it('does not focus when an editable field is already focused', () => {
    render(
      <>
        <SearchField label="Search plugins" />
        <textarea aria-label="Notes" defaultValue="" />
      </>,
    );
    const input = screen.getByLabelText('Search plugins');
    const notes = screen.getByLabelText('Notes');
    notes.focus();
    notes.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));

    expect(document.activeElement).toBe(notes);
    expect(document.activeElement).not.toBe(input);
  });

  it('does not focus when / is pressed with a modifier (regex slash)', () => {
    render(<SearchField label="Search asset packs" />);
    const input = screen.getByLabelText('Search asset packs');

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true }),
    );

    expect(document.activeElement).not.toBe(input);
  });
});
