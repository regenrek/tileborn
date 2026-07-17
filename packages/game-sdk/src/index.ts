export {
  builtInCapabilityIds,
  capabilityInventory,
  type BuiltInCapabilityId,
} from './generated/capabilities.js';
export * from './harness.js';
export * from './types.js';

import type {
  AssetReference,
  BehaviorDefinition,
  BehaviorModule,
  BehaviorReference,
  CatalogReference,
  EntityReference,
  ReferenceMap,
  SerializableState,
  GameEventRegistry,
} from './types.js';

const BEHAVIOR_ID_PATTERN =
  /^(?:[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+|behavior:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

export const defineBehavior = <
  const Id extends string,
  const State extends SerializableState,
  const Refs extends ReferenceMap = Record<never, never>,
>(
  definition: BehaviorDefinition<Id, State, Refs>,
): BehaviorModule<Id, State, Refs> => {
  if (!BEHAVIOR_ID_PATTERN.test(definition.id)) {
    throw new TypeError(
      `TBSDK0001: behavior id "${definition.id}" must be a dotted lowercase identifier or canonical behavior UUID`,
    );
  }
  return Object.freeze({ ...definition, sourceKind: 'typescript' as const });
};

export const eventId = <Id extends keyof GameEventRegistry & string>(id: Id): Id => id;

export const events = Object.freeze({
  runtime: Object.freeze({ tick: eventId('runtime.tick') }),
  lifecycle: Object.freeze({
    started: eventId('lifecycle.started'),
    stopped: eventId('lifecycle.stopped'),
    reloaded: eventId('lifecycle.reloaded'),
  }),
  timer: Object.freeze({ fired: eventId('timer.fired') }),
});

export const refs = Object.freeze({
  entity: <const Kind extends string = string>(objectId: string): EntityReference<Kind> => ({
    _tag: 'entity',
    objectId,
  }),
  asset: <const Kind extends string = string>(assetId: string): AssetReference<Kind> => ({
    _tag: 'asset',
    assetId,
  }),
  catalog: <const Kind extends string = string>(objectTypeId: string): CatalogReference<Kind> => ({
    _tag: 'catalog',
    objectTypeId,
  }),
  behavior: (behaviorId: string): BehaviorReference => ({ _tag: 'behavior', behaviorId }),
});
