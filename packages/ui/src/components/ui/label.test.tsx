import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Label } from './label.js';

describe('Label', () => {
  it('renders associated text', () => {
    render(<Label htmlFor="map-name">Map name</Label>);
    expect(screen.getByText('Map name')).toBeInTheDocument();
  });
});
