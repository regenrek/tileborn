import { describe, expect, it } from 'vitest';

import {
  applyRuntimeInputEdges,
  clearRuntimeInputEdges,
  createRuntimeInputEdgeTransport,
  hasRuntimeInputEdges,
  mergeRuntimeInputEdges,
  type RuntimeInputEdgeField,
} from './edge-buffer.js';

interface TestInput extends Record<string, unknown> {
  readonly shoot: boolean;
  readonly reload: boolean;
  readonly abilities: readonly string[];
  readonly aimDeg?: number;
  readonly swapSlot?: number;
}

const edgeFields = ['reload', 'abilities', 'swapSlot'] as const;
const shootEdgeFields = ['shoot'] as const;
const heldShootEdgeOptions = {
  heldBooleanFields: () => shootEdgeFields,
};

describe('runtime input edge buffer', () => {
  it('merges only plugin-declared edge fields and leaves held fields out of the buffer', () => {
    const first: TestInput = {
      shoot: true,
      reload: true,
      abilities: ['dash'],
      aimDeg: 45,
      swapSlot: 2,
    };
    const second: TestInput = {
      shoot: false,
      reload: false,
      abilities: ['scan'],
      aimDeg: 90,
      swapSlot: 3,
    };

    const pending = mergeRuntimeInputEdges(undefined, first, edgeFields);
    const merged = mergeRuntimeInputEdges(pending, second, edgeFields);

    expect(hasRuntimeInputEdges(first, edgeFields)).toBe(true);
    expect(merged.version).toBe(2);
    expect(merged.values).toEqual({
      reload: true,
      abilities: ['dash', 'scan'],
      swapSlot: 3,
    });
  });

  it('applies and clears declared edge fields without knowing their gameplay meaning', () => {
    const base: TestInput = {
      shoot: true,
      reload: false,
      abilities: [],
      aimDeg: 90,
    };
    const pending = mergeRuntimeInputEdges(
      undefined,
      { ...base, reload: true, abilities: ['dash'], swapSlot: 2 },
      edgeFields,
    );

    expect(applyRuntimeInputEdges(base, pending, edgeFields)).toEqual({
      shoot: true,
      reload: true,
      abilities: ['dash'],
      aimDeg: 90,
      swapSlot: 2,
    });
    expect(
      clearRuntimeInputEdges(
        { ...base, reload: true, abilities: ['dash'], swapSlot: 2 },
        edgeFields,
      ),
    ).toEqual({
      shoot: true,
      reload: false,
      abilities: [],
      aimDeg: 90,
    });
  });

  it('owns per-player edge delivery and acknowledges consumed edges once', () => {
    let currentEdgeFields: readonly RuntimeInputEdgeField<TestInput>[] = edgeFields;
    const transport = createRuntimeInputEdgeTransport<TestInput>(() => currentEdgeFields);

    expect(
      transport.set('player-1', {
        shoot: false,
        reload: false,
        abilities: [],
        aimDeg: 45,
        swapSlot: 2,
      }),
    ).toEqual({
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 45,
      swapSlot: 2,
    });

    expect(
      transport.set('player-1', {
        shoot: false,
        reload: false,
        abilities: [],
        aimDeg: 90,
      }),
    ).toEqual({
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 90,
      swapSlot: 2,
    });

    transport.acknowledgePending(transport.capturePendingAcknowledgement());
    expect(transport.get('player-1')).toEqual({
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 90,
    });

    currentEdgeFields = ['reload'];
    expect(
      transport.set('player-1', {
        shoot: true,
        reload: false,
        abilities: ['dash'],
        aimDeg: 135,
        swapSlot: 3,
      }),
    ).toEqual({
      shoot: true,
      reload: false,
      abilities: ['dash'],
      aimDeg: 135,
      swapSlot: 3,
    });
    transport.delete('player-1');
    expect(transport.get('player-1')).toBeUndefined();
  });

  it('retains edges queued after the consumed step was captured', () => {
    const transport = createRuntimeInputEdgeTransport<TestInput>(() => edgeFields);

    transport.set('player-1', {
      shoot: false,
      reload: true,
      abilities: [],
      aimDeg: 45,
    });
    const consumedStep = transport.capturePendingAcknowledgement();

    transport.set('player-1', {
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 90,
      swapSlot: 3,
    });

    transport.acknowledgePending(consumedStep);
    expect(transport.get('player-1')).toEqual({
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 90,
      swapSlot: 3,
    });

    transport.acknowledgePending(transport.capturePendingAcknowledgement());
    expect(transport.get('player-1')).toEqual({
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 90,
    });
  });

  it('removes consumed array entries while retaining newer entries for the same field', () => {
    const transport = createRuntimeInputEdgeTransport<TestInput>(() => edgeFields);

    transport.set('player-1', {
      shoot: false,
      reload: false,
      abilities: ['dash'],
      aimDeg: 45,
    });
    const consumedStep = transport.capturePendingAcknowledgement();

    transport.set('player-1', {
      shoot: false,
      reload: false,
      abilities: ['scan'],
      aimDeg: 90,
    });

    transport.acknowledgePending(consumedStep);
    expect(transport.get('player-1')).toEqual({
      shoot: false,
      reload: false,
      abilities: ['scan'],
      aimDeg: 90,
    });

    transport.acknowledgePending(transport.capturePendingAcknowledgement());
    expect(transport.get('player-1')).toEqual({
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 90,
    });
  });

  it('preserves a complete press and release until one consumer acknowledgement', () => {
    const transport = createRuntimeInputEdgeTransport<TestInput>(
      () => shootEdgeFields,
      heldShootEdgeOptions,
    );

    expect(
      transport.set('player-1', {
        shoot: true,
        reload: false,
        abilities: [],
        aimDeg: 0,
      }),
    ).toEqual({
      shoot: true,
      reload: false,
      abilities: [],
      aimDeg: 0,
    });
    expect(
      transport.set('player-1', {
        shoot: false,
        reload: false,
        abilities: [],
        aimDeg: 0,
      }),
    ).toEqual({
      shoot: true,
      reload: false,
      abilities: [],
      aimDeg: 0,
    });

    transport.acknowledgePending(transport.capturePendingAcknowledgement());
    expect(transport.get('player-1')).toEqual({
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 0,
    });
  });

  it('keeps a held boolean edge true after the pending pulse is acknowledged', () => {
    const transport = createRuntimeInputEdgeTransport<TestInput>(
      () => shootEdgeFields,
      heldShootEdgeOptions,
    );

    transport.set('player-1', {
      shoot: true,
      reload: false,
      abilities: [],
      aimDeg: 0,
    });

    transport.acknowledgePending(transport.capturePendingAcknowledgement());
    expect(transport.get('player-1')).toEqual({
      shoot: true,
      reload: false,
      abilities: [],
      aimDeg: 0,
    });

    expect(
      transport.set('player-1', {
        shoot: false,
        reload: false,
        abilities: [],
        aimDeg: 0,
      }),
    ).toEqual({
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 0,
    });
  });

  it('clears acknowledged one-shot boolean edges even when the latest base frame is still true', () => {
    const transport = createRuntimeInputEdgeTransport<TestInput>(() => ['reload']);

    transport.set('player-1', {
      shoot: false,
      reload: true,
      abilities: [],
      aimDeg: 0,
    });

    transport.acknowledgePending(transport.capturePendingAcknowledgement());
    expect(transport.get('player-1')).toEqual({
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 0,
    });

    expect(
      transport.set('player-1', {
        shoot: false,
        reload: true,
        abilities: [],
        aimDeg: 0,
      }),
    ).toEqual({
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 0,
    });

    transport.set('player-1', {
      shoot: false,
      reload: false,
      abilities: [],
      aimDeg: 0,
    });
    expect(
      transport.set('player-1', {
        shoot: false,
        reload: true,
        abilities: [],
        aimDeg: 0,
      }),
    ).toEqual({
      shoot: false,
      reload: true,
      abilities: [],
      aimDeg: 0,
    });
  });
});
