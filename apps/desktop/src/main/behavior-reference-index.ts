import type { BehaviorReference } from '@tileborne/core';
import type { BehaviorReferenceKind } from '@tileborne/ipc-contracts';

import { paginateBehaviorReferenceOptions } from './behavior-reference-pagination.js';

export interface IndexedBehaviorReferenceOption {
  readonly id: string;
  readonly label: string;
  readonly reference: BehaviorReference;
  readonly previewUrl?: string | undefined;
  readonly detail?: string | undefined;
}

type Loader = () => Promise<readonly IndexedBehaviorReferenceOption[]>;

const keyFor = (projectId: string, kind: BehaviorReferenceKind): string => `${projectId}:${kind}`;

export const behaviorReferenceId = (reference: BehaviorReference): string => {
  switch (reference._tag) {
    case 'entity':
      return String(reference.objectId);
    case 'asset':
      return String(reference.assetId);
    case 'catalog':
      return String(reference.objectTypeId);
    case 'behavior':
      return String(reference.behaviorId);
  }
};

/**
 * Main-process source index. One build is shared by concurrent searches/pages;
 * invalidation drops both settled and in-flight generations atomically.
 */
export class BehaviorReferenceIndex {
  readonly #settled = new Map<string, readonly IndexedBehaviorReferenceOption[]>();
  readonly #inFlight = new Map<string, Promise<readonly IndexedBehaviorReferenceOption[]>>();
  readonly #generations = new Map<string, number>();

  async load(
    projectId: string,
    kind: BehaviorReferenceKind,
    loader: Loader,
  ): Promise<readonly IndexedBehaviorReferenceOption[]> {
    const key = keyFor(projectId, kind);
    const settled = this.#settled.get(key);
    if (settled !== undefined) return settled;
    const active = this.#inFlight.get(key);
    if (active !== undefined) return active;
    const generation = this.#generations.get(key) ?? 0;
    const request = loader()
      .then((options) =>
        [...options].sort(
          (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
        ),
      )
      .then((options) => {
        if ((this.#generations.get(key) ?? 0) === generation) this.#settled.set(key, options);
        return options;
      })
      .finally(() => {
        if (this.#inFlight.get(key) === request) this.#inFlight.delete(key);
      });
    this.#inFlight.set(key, request);
    return request;
  }

  async query(
    projectId: string,
    kind: BehaviorReferenceKind,
    input: { readonly query?: string; readonly offset?: number; readonly limit?: number },
    loader: Loader,
  ) {
    const options = await this.load(projectId, kind, loader);
    return paginateBehaviorReferenceOptions(options, input);
  }

  invalidate(projectId?: string, kind?: BehaviorReferenceKind): void {
    const matches = (key: string) => {
      if (projectId === undefined) return true;
      if (!key.startsWith(`${projectId}:`)) return false;
      return kind === undefined || key === keyFor(projectId, kind);
    };
    const keys = new Set([...this.#settled.keys(), ...this.#inFlight.keys()]);
    for (const key of keys) {
      if (!matches(key)) continue;
      this.#settled.delete(key);
      this.#inFlight.delete(key);
      this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    }
  }
}
