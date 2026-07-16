// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clampClipDraftsToFrameCount,
  reorderClipDrafts,
  type ClipDraft,
} from './sprite-animation-drafts';
import { SpriteAnimationStudio } from './sprite-animation-studio';

vi.mock('@/hooks/mutations', () => ({
  useImportSpriteSheet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

class TestImage {
  naturalWidth = 64;
  naturalHeight = 64;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const clip = (id: string): ClipDraft => ({
  id,
  name: id,
  fromFrame: 0,
  toFrame: 0,
  fps: 10,
  loop: true,
});

describe('Sprite Animation Studio clip ordering', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', TestImage);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reorders clips without changing their authored metadata', () => {
    const clips = [clip('idle'), clip('walk'), clip('shoot')] as const;

    const reordered = reorderClipDrafts(clips, 'shoot', -1);

    expect(reordered.map((entry) => entry.id)).toEqual(['idle', 'shoot', 'walk']);
    expect(reordered[1]).toBe(clips[2]);
    expect(clips.map((entry) => entry.id)).toEqual(['idle', 'walk', 'shoot']);
  });

  it('keeps the canonical order unchanged at either boundary', () => {
    const clips = [clip('idle'), clip('walk')] as const;

    expect(reorderClipDrafts(clips, 'idle', -1)).toBe(clips);
    expect(reorderClipDrafts(clips, 'walk', 1)).toBe(clips);
    expect(reorderClipDrafts(clips, 'missing', 1)).toBe(clips);
  });

  it('clamps stale clip ranges when the slice grid reduces the frame count', () => {
    const clips = [{ ...clip('default'), fromFrame: 120, toFrame: 2783 }];

    expect(clampClipDraftsToFrameCount(clips, 54)).toEqual([
      expect.objectContaining({ fromFrame: 53, toFrame: 53 }),
    ]);
    expect(clampClipDraftsToFrameCount([{ ...clip('idle'), toFrame: 2783 }], 54)).toEqual([
      expect.objectContaining({ fromFrame: 0, toFrame: 53 }),
    ]);
  });

  it('selects preview clips with semantic radio focus, arrows, Enter, and Space', async () => {
    render(<SpriteAnimationStudio open onOpenChange={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(1));

    vi.spyOn(Date, 'now').mockReturnValueOnce(101).mockReturnValueOnce(102);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(3));

    const radios = screen.getAllByRole('radio') as HTMLButtonElement[];
    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: 'ArrowDown' });
    expect(radios[1]!.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radios[1]);

    radios[2]!.focus();
    fireEvent.keyDown(radios[2]!, { key: 'Enter' });
    expect(radios[2]!.getAttribute('aria-checked')).toBe('true');

    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: ' ' });
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
    expect(radios.filter((radio) => radio.tabIndex === 0)).toEqual([radios[0]]);
  });
});
