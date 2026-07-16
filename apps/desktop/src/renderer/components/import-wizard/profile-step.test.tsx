// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TiledImportRecommendation } from '@tileborne/ipc-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileStep } from './profile-step';

const recommendation = {
  sourceRoles: [
    {
      kind: 'placeable-object',
      evidence: 'image-collection',
      confidence: 0.96,
      count: 12,
      tilesetName: 'Atlas Props Sprites',
      browseTarget: 'objects',
      reviewRequired: false,
      rationale: 'Image-collection tiles are placeable Objects.',
    },
  ],
  recommendedProfile: 'standard-plus-hints',
  primaryAction: 'import-placeable-objects',
  browseTarget: 'objects',
  rationale: 'The source is an image collection, so imported content should open as Objects.',
  reviewRequired: false,
} satisfies TiledImportRecommendation;

describe('ProfileStep', () => {
  afterEach(() => cleanup());

  it('labels and selects the SDK auto-detected recommendation', () => {
    render(
      <ProfileStep
        profile="standard-plus-hints"
        recommendation={recommendation}
        onProfileChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('import-profile-recommendation').textContent).toContain(
      'Auto-detected recommendation: Standard + Hints',
    );
    expect(screen.getByText('Auto-detected')).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: 'Standard + Hints' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('keeps expert overrides explicit', () => {
    const onProfileChange = vi.fn();
    render(
      <ProfileStep
        profile="standard"
        recommendation={recommendation}
        onProfileChange={onProfileChange}
      />,
    );

    expect(screen.getByText('Expert override active.')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Assistive Infer' }));
    expect(onProfileChange).toHaveBeenCalledWith('assistive-infer');
  });
});
