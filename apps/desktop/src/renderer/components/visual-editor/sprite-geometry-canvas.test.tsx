import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpriteGeometryCanvas } from './sprite-geometry-canvas';

afterEach(() => cleanup());

const handles = [
  { id: 'pivot', label: 'Pivot', kind: 'pivot' as const, point: { x: 0.5, y: 0.5 } },
  { id: 'muzzle', label: 'Muzzle', kind: 'muzzle' as const, point: { x: 0.85, y: 0.45 } },
] as const;

const rects = [
  {
    id: 'hitbox',
    label: 'Hitbox',
    kind: 'hitbox' as const,
    rect: { x: 0.2, y: 0.1, width: 0.5, height: 0.8 },
  },
] as const;

describe('SpriteGeometryCanvas', () => {
  it('renders handles, rect overlays, frame selection, and numeric fields', () => {
    const onFrameChange = vi.fn();
    const { container } = render(
      <SpriteGeometryCanvas
        title="Model Geometry"
        handles={handles}
        rects={rects}
        frames={[{ id: 'idle', label: 'Idle' }, { id: 'shoot', label: 'Shoot' }]}
        activeFrameId="idle"
        onHandleChange={vi.fn()}
        onFrameChange={onFrameChange}
      />,
    );

    expect(screen.getByTestId('sprite-geometry-handle-pivot')).toBeTruthy();
    expect(screen.getByTestId('sprite-geometry-rect-hitbox')).toBeTruthy();
    fireEvent.change(screen.getByTestId('sprite-geometry-frame'), { target: { value: 'shoot' } });
    expect(onFrameChange).toHaveBeenCalledWith('shoot');
    expect(container.querySelectorAll('input')).toHaveLength(10);
  });

  it('binds numeric handle fields and reset defaults', () => {
    const onHandleChange = vi.fn();
    const onResetDefaults = vi.fn();
    const { container } = render(
      <SpriteGeometryCanvas
        title="Weapon Geometry"
        handles={handles}
        onHandleChange={onHandleChange}
        onResetDefaults={onResetDefaults}
      />,
    );

    const inputs = container.querySelectorAll('input');
    fireEvent.change(inputs[2]!, { target: { value: '0.25' } });
    expect(onHandleChange).toHaveBeenCalledWith('pivot', { x: 0.25, y: 0.5 });

    fireEvent.click(screen.getByTestId('sprite-geometry-reset'));
    expect(onResetDefaults).toHaveBeenCalledOnce();
  });

  it('drags point handles in normalized sprite coordinates', () => {
    const onHandleChange = vi.fn();
    render(
      <SpriteGeometryCanvas
        title="Weapon Geometry"
        handles={handles}
        snapStep={0.01}
        onHandleChange={onHandleChange}
      />,
    );

    const stage = screen.getByTestId('sprite-geometry-stage');
    Object.defineProperty(stage, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 200,
        height: 200,
        right: 200,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }),
    });
    const circle = screen.getByTestId('sprite-geometry-handle-muzzle').querySelector('circle');
    expect(circle).not.toBeNull();

    fireEvent.pointerDown(circle!, { pointerId: 1, clientX: 170, clientY: 90 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 160, clientY: 40 });
    fireEvent.pointerUp(stage, { pointerId: 1 });

    expect(onHandleChange).toHaveBeenCalledWith('muzzle', { x: 0.8, y: 0.2 });
  });
});
