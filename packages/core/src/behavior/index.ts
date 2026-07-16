import { Schema } from 'effect';

import {
  AssetId,
  BehaviorId,
  BehaviorNodeId,
  ContentHash,
  GameObjectTypeId,
  ObjectId,
} from '../ids.js';
import { JsonObject, JsonValue } from '../project/index.js';
import { PERSISTED_SCHEMA_VERSIONS } from '../versioning/persisted-schema-registry.js';

/** Current persisted visual behavior resource version. */
export const BEHAVIOR_DEFINITION_SCHEMA_VERSION = PERSISTED_SCHEMA_VERSIONS.behaviorDefinition;

/** Current runtime package payload version. Independent from the outer map package. */
export const BEHAVIOR_PACKAGE_SCHEMA_VERSION = PERSISTED_SCHEMA_VERSIONS.runtimeBehaviorPackage;

/** Stable open identifier contributed by the engine or a plugin registry. */
export const BehaviorRegistryEntryId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/),
).pipe(Schema.brand('BehaviorRegistryEntryId'));
export type BehaviorRegistryEntryId = typeof BehaviorRegistryEntryId.Type;

/** Open capability id used for discovery and runtime permission checks. */
export const BehaviorCapabilityId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/),
).pipe(Schema.brand('BehaviorCapabilityId'));
export type BehaviorCapabilityId = typeof BehaviorCapabilityId.Type;

/** Native TypeScript and visual resources are the only canonical source kinds. */
export const BehaviorSourceKind = Schema.Literals(['visual', 'typescript']);
export type BehaviorSourceKind = typeof BehaviorSourceKind.Type;

export class EntityBehaviorReference extends Schema.TaggedClass<EntityBehaviorReference>()(
  'entity',
  { objectId: ObjectId },
) {}

export class AssetBehaviorReference extends Schema.TaggedClass<AssetBehaviorReference>()('asset', {
  assetId: AssetId,
}) {}

export class CatalogBehaviorReference extends Schema.TaggedClass<CatalogBehaviorReference>()(
  'catalog',
  { objectTypeId: GameObjectTypeId },
) {}

export class NestedBehaviorReference extends Schema.TaggedClass<NestedBehaviorReference>()(
  'behavior',
  { behaviorId: BehaviorId },
) {}

/** Durable references supported by both visual authoring and the TypeScript SDK. */
export const BehaviorReference = Schema.Union([
  EntityBehaviorReference,
  AssetBehaviorReference,
  CatalogBehaviorReference,
  NestedBehaviorReference,
]);
export type BehaviorReference = typeof BehaviorReference.Type;

export class LiteralBehaviorValue extends Schema.TaggedClass<LiteralBehaviorValue>()('literal', {
  value: JsonValue,
}) {}

export class StateBehaviorValue extends Schema.TaggedClass<StateBehaviorValue>()('state', {
  key: Schema.String,
}) {}

export class EventFieldBehaviorValue extends Schema.TaggedClass<EventFieldBehaviorValue>()(
  'event-field',
  { path: Schema.String },
) {}

export class ReferenceBehaviorValue extends Schema.TaggedClass<ReferenceBehaviorValue>()(
  'reference',
  { reference: BehaviorReference },
) {}

/** Typed expression leaf; executable JavaScript is deliberately not representable here. */
export const BehaviorValueExpression = Schema.Union([
  LiteralBehaviorValue,
  StateBehaviorValue,
  EventFieldBehaviorValue,
  ReferenceBehaviorValue,
]);
export type BehaviorValueExpression = typeof BehaviorValueExpression.Type;

export class BehaviorInvocation extends Schema.Class<BehaviorInvocation>('BehaviorInvocation')({
  entryId: BehaviorRegistryEntryId,
  arguments: Schema.Record(Schema.String, BehaviorValueExpression),
}) {}

export interface BehaviorConditionCall {
  readonly _tag: 'condition';
  readonly nodeId: BehaviorNodeId;
  readonly invocation: BehaviorInvocation;
}

export interface BehaviorAllCondition {
  readonly _tag: 'all';
  readonly nodeId: BehaviorNodeId;
  readonly conditions: ReadonlyArray<BehaviorCondition>;
}

export interface BehaviorAnyCondition {
  readonly _tag: 'any';
  readonly nodeId: BehaviorNodeId;
  readonly conditions: ReadonlyArray<BehaviorCondition>;
}

export interface BehaviorNotCondition {
  readonly _tag: 'not';
  readonly nodeId: BehaviorNodeId;
  readonly condition: BehaviorCondition;
}

export type BehaviorCondition =
  | BehaviorConditionCall
  | BehaviorAllCondition
  | BehaviorAnyCondition
  | BehaviorNotCondition;

/** Recursive WHEN/IF condition tree used by the event sheet. */
export const BehaviorCondition: Schema.Codec<BehaviorCondition, unknown> = Schema.suspend(
  (): Schema.Codec<BehaviorCondition, unknown> =>
    Schema.Union([
      Schema.Struct({
        _tag: Schema.Literal('condition'),
        nodeId: BehaviorNodeId,
        invocation: BehaviorInvocation,
      }),
      Schema.Struct({
        _tag: Schema.Literal('all'),
        nodeId: BehaviorNodeId,
        conditions: Schema.Array(BehaviorCondition),
      }),
      Schema.Struct({
        _tag: Schema.Literal('any'),
        nodeId: BehaviorNodeId,
        conditions: Schema.Array(BehaviorCondition),
      }),
      Schema.Struct({
        _tag: Schema.Literal('not'),
        nodeId: BehaviorNodeId,
        condition: BehaviorCondition,
      }),
    ]),
);

export interface BehaviorActionCall {
  readonly _tag: 'action';
  readonly nodeId: BehaviorNodeId;
  readonly invocation: BehaviorInvocation;
}

export interface BehaviorBranchAction {
  readonly _tag: 'branch';
  readonly nodeId: BehaviorNodeId;
  readonly condition: BehaviorCondition;
  readonly then: ReadonlyArray<BehaviorActionNode>;
  readonly else?: ReadonlyArray<BehaviorActionNode> | undefined;
}

export type BehaviorActionNode = BehaviorActionCall | BehaviorBranchAction;

/** Ordered action tree. Array order is the durable sequence; branches may nest. */
export const BehaviorActionNode: Schema.Codec<BehaviorActionNode, unknown> = Schema.suspend(
  (): Schema.Codec<BehaviorActionNode, unknown> =>
    Schema.Union([
      Schema.Struct({
        _tag: Schema.Literal('action'),
        nodeId: BehaviorNodeId,
        invocation: BehaviorInvocation,
      }),
      Schema.Struct({
        _tag: Schema.Literal('branch'),
        nodeId: BehaviorNodeId,
        condition: BehaviorCondition,
        then: Schema.Array(BehaviorActionNode),
        else: Schema.optional(Schema.Array(BehaviorActionNode)),
      }),
    ]),
);

export class BehaviorStateField extends Schema.Class<BehaviorStateField>('BehaviorStateField')({
  key: Schema.String,
  label: Schema.String,
  initialValue: JsonValue,
}) {}

/** Canonical persisted resource emitted by the visual WHEN/IF/DO editor. */
export class BehaviorDefinition extends Schema.Class<BehaviorDefinition>('BehaviorDefinition')({
  schemaVersion: Schema.Literal(BEHAVIOR_DEFINITION_SCHEMA_VERSION),
  id: BehaviorId,
  label: Schema.String,
  state: Schema.Array(BehaviorStateField),
  when: BehaviorInvocation,
  if: Schema.optional(BehaviorCondition),
  do: Schema.Array(BehaviorActionNode),
}) {}

export class VisualBehaviorSource extends Schema.TaggedClass<VisualBehaviorSource>()('visual', {
  definitionPath: Schema.String,
}) {}

export class TypeScriptBehaviorSource extends Schema.TaggedClass<TypeScriptBehaviorSource>()(
  'typescript',
  {
    sourcePath: Schema.String,
    exportName: Schema.String,
  },
) {}

/** A behavior has exactly one canonical authoring source; hybrid/dual ownership is impossible. */
export const BehaviorSource = Schema.Union([VisualBehaviorSource, TypeScriptBehaviorSource]);
export type BehaviorSource = typeof BehaviorSource.Type;

export class BehaviorManifest extends Schema.Class<BehaviorManifest>('BehaviorManifest')({
  schemaVersion: Schema.Literal(PERSISTED_SCHEMA_VERSIONS.behaviorManifest),
  id: BehaviorId,
  label: Schema.String,
  source: BehaviorSource,
  requiredCapabilities: Schema.Array(BehaviorCapabilityId),
}) {}

/** One compiled ESM module consumed by the single runtime scheduler. */
export class BehaviorModuleArtifact extends Schema.Class<BehaviorModuleArtifact>(
  'BehaviorModuleArtifact',
)({
  behaviorId: BehaviorId,
  sourceKind: BehaviorSourceKind,
  modulePath: Schema.String,
  hash: ContentHash,
}) {}

/** RuntimeMapPackage behavior section. Source files are never executed directly. */
export class RuntimeBehaviorPackage extends Schema.Class<RuntimeBehaviorPackage>(
  'RuntimeBehaviorPackage',
)({
  schemaVersion: Schema.Literal(BEHAVIOR_PACKAGE_SCHEMA_VERSION),
  manifests: Schema.Array(BehaviorManifest),
  visualDefinitions: Schema.Array(BehaviorDefinition),
  modules: Schema.Array(BehaviorModuleArtifact),
}) {}

export const EMPTY_RUNTIME_BEHAVIOR_PACKAGE = new RuntimeBehaviorPackage({
  schemaVersion: BEHAVIOR_PACKAGE_SCHEMA_VERSION,
  manifests: [],
  visualDefinitions: [],
  modules: [],
});

export const BehaviorRegistryValueKind = Schema.Literals([
  'boolean',
  'number',
  'string',
  'json',
  'entity-reference',
  'asset-reference',
  'catalog-reference',
  'behavior-reference',
]);
export type BehaviorRegistryValueKind = typeof BehaviorRegistryValueKind.Type;

export class BehaviorParameterMetadata extends Schema.Class<BehaviorParameterMetadata>(
  'BehaviorParameterMetadata',
)({
  key: Schema.String,
  label: Schema.String,
  valueKind: BehaviorRegistryValueKind,
  required: Schema.Boolean,
  description: Schema.optional(Schema.String),
  /** Optional literal used when a creator inserts the block. */
  defaultValue: Schema.optional(JsonValue),
}) {}

export const BehaviorRegistryEntryKind = Schema.Literals(['event', 'condition', 'action']);
export type BehaviorRegistryEntryKind = typeof BehaviorRegistryEntryKind.Type;

/** Genre-neutral registry metadata drives SDK discovery and the visual editor. */
export class BehaviorRegistryEntry extends Schema.Class<BehaviorRegistryEntry>(
  'BehaviorRegistryEntry',
)({
  id: BehaviorRegistryEntryId,
  kind: BehaviorRegistryEntryKind,
  label: Schema.String,
  category: Schema.String,
  description: Schema.String,
  capability: BehaviorCapabilityId,
  /** Declarative icon name. Renderers resolve this through their own safe icon set. */
  icon: Schema.optional(Schema.String),
  inputs: Schema.Array(BehaviorParameterMetadata),
  outputs: Schema.Array(BehaviorParameterMetadata),
}) {}

export class BehaviorRegistryManifest extends Schema.Class<BehaviorRegistryManifest>(
  'BehaviorRegistryManifest',
)({
  schemaVersion: Schema.Literal(PERSISTED_SCHEMA_VERSIONS.behaviorRegistryCatalog),
  entries: Schema.Array(BehaviorRegistryEntry),
}) {}

export const BehaviorTemplateId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/),
).pipe(Schema.brand('BehaviorTemplateId'));
export type BehaviorTemplateId = typeof BehaviorTemplateId.Type;

export class BehaviorTemplateInvocation extends Schema.Class<BehaviorTemplateInvocation>(
  'BehaviorTemplateInvocation',
)({
  entryId: BehaviorRegistryEntryId,
  arguments: Schema.Record(Schema.String, JsonValue),
}) {}

/**
 * Declarative starter sheet. Node/resource ids are intentionally absent and
 * are allocated by the authoring client when the template is instantiated.
 */
export class BehaviorTemplate extends Schema.Class<BehaviorTemplate>('BehaviorTemplate')({
  id: BehaviorTemplateId,
  label: Schema.String,
  description: Schema.String,
  category: Schema.String,
  icon: Schema.optional(Schema.String),
  requiredCapabilities: Schema.Array(BehaviorCapabilityId),
  when: BehaviorTemplateInvocation,
  if: Schema.optional(Schema.Array(BehaviorTemplateInvocation)),
  do: Schema.Array(BehaviorTemplateInvocation),
}) {}

const parameter = (
  key: string,
  label: string,
  valueKind: BehaviorRegistryValueKind,
  required: boolean,
  defaultValue?: JsonValue,
): BehaviorParameterMetadata =>
  new BehaviorParameterMetadata({
    key,
    label,
    valueKind,
    required,
    ...(defaultValue === undefined ? {} : { defaultValue }),
  });

const registryEntryId = (value: string): BehaviorRegistryEntryId =>
  Schema.decodeUnknownSync(BehaviorRegistryEntryId)(value);
const capabilityId = (value: string): BehaviorCapabilityId =>
  Schema.decodeUnknownSync(BehaviorCapabilityId)(value);
const templateId = (value: string): BehaviorTemplateId =>
  Schema.decodeUnknownSync(BehaviorTemplateId)(value);

/** Engine-owned capabilities available to every project and every game genre. */
export const CORE_BEHAVIOR_REGISTRY = new BehaviorRegistryManifest({
  schemaVersion: PERSISTED_SCHEMA_VERSIONS.behaviorRegistryCatalog,
  entries: [
    new BehaviorRegistryEntry({
      id: registryEntryId('runtime.tick'),
      kind: 'event',
      label: 'Simulation tick',
      category: 'Runtime',
      description: 'Runs once for each deterministic simulation tick.',
      capability: capabilityId('time.deterministic'),
      icon: 'clock-3',
      inputs: [],
      outputs: [parameter('tick', 'Tick', 'number', true)],
    }),
    new BehaviorRegistryEntry({
      id: registryEntryId('lifecycle.started'),
      kind: 'event',
      label: 'Behavior started',
      category: 'Lifecycle',
      description: 'Runs once when this behavior instance starts.',
      capability: capabilityId('lifecycle.core'),
      icon: 'play',
      inputs: [],
      outputs: [],
    }),
    new BehaviorRegistryEntry({
      id: registryEntryId('lifecycle.reloaded'),
      kind: 'event',
      label: 'Behavior reloaded',
      category: 'Lifecycle',
      description: 'Runs after a successful hot reload.',
      capability: capabilityId('lifecycle.core'),
      icon: 'refresh-cw',
      inputs: [],
      outputs: [],
    }),
    new BehaviorRegistryEntry({
      id: registryEntryId('timer.fired'),
      kind: 'event',
      label: 'Timer fired',
      category: 'Time',
      description: 'Runs when a deterministic named timer fires.',
      capability: capabilityId('time.deterministic'),
      icon: 'timer',
      inputs: [parameter('timerId', 'Timer', 'string', true, 'timer')],
      outputs: [],
    }),
    new BehaviorRegistryEntry({
      id: registryEntryId('state.equals'),
      kind: 'condition',
      label: 'Local state equals',
      category: 'State',
      description: 'Checks a local state field against a literal value.',
      capability: capabilityId('state.core'),
      icon: 'equal',
      inputs: [
        parameter('key', 'State field', 'string', true, 'value'),
        parameter('value', 'Value', 'json', true, null),
      ],
      outputs: [],
    }),
    new BehaviorRegistryEntry({
      id: registryEntryId('state.set'),
      kind: 'action',
      label: 'Set local state',
      category: 'State',
      description: 'Updates a serializable local state field.',
      capability: capabilityId('state.core'),
      icon: 'variable',
      inputs: [
        parameter('key', 'State field', 'string', true, 'value'),
        parameter('value', 'Value', 'json', true, null),
      ],
      outputs: [],
    }),
    new BehaviorRegistryEntry({
      id: registryEntryId('timer.after'),
      kind: 'action',
      label: 'Start one-shot timer',
      category: 'Time',
      description: 'Fires a named timer once after deterministic simulation ticks.',
      capability: capabilityId('time.deterministic'),
      icon: 'timer-reset',
      inputs: [
        parameter('ticks', 'Ticks', 'number', true, 60),
        parameter('timerId', 'Timer', 'string', true, 'timer'),
      ],
      outputs: [],
    }),
    new BehaviorRegistryEntry({
      id: registryEntryId('timer.every'),
      kind: 'action',
      label: 'Start repeating timer',
      category: 'Time',
      description: 'Fires a named timer repeatedly on deterministic simulation ticks.',
      capability: capabilityId('time.deterministic'),
      icon: 'repeat-2',
      inputs: [
        parameter('ticks', 'Ticks', 'number', true, 60),
        parameter('timerId', 'Timer', 'string', true, 'timer'),
      ],
      outputs: [],
    }),
    new BehaviorRegistryEntry({
      id: registryEntryId('timer.cancel'),
      kind: 'action',
      label: 'Cancel timer',
      category: 'Time',
      description: 'Cancels a deterministic named timer.',
      capability: capabilityId('time.deterministic'),
      icon: 'timer-off',
      inputs: [parameter('timerId', 'Timer', 'string', true, 'timer')],
      outputs: [],
    }),
  ],
});

export const CORE_BEHAVIOR_TEMPLATES: readonly BehaviorTemplate[] = [
  new BehaviorTemplate({
    id: templateId('core.on-start'),
    label: 'On start',
    description: 'Start with a WHEN block and add actions in order.',
    category: 'Core',
    icon: 'play',
    requiredCapabilities: [capabilityId('lifecycle.core')],
    when: new BehaviorTemplateInvocation({
      entryId: registryEntryId('lifecycle.started'),
      arguments: {},
    }),
    do: [],
  }),
  new BehaviorTemplate({
    id: templateId('core.repeating-timer'),
    label: 'Repeating timer',
    description: 'Start a deterministic repeating timer when the behavior starts.',
    category: 'Time',
    icon: 'repeat-2',
    requiredCapabilities: [capabilityId('lifecycle.core'), capabilityId('time.deterministic')],
    when: new BehaviorTemplateInvocation({
      entryId: registryEntryId('lifecycle.started'),
      arguments: {},
    }),
    do: [
      new BehaviorTemplateInvocation({
        entryId: registryEntryId('timer.every'),
        arguments: { ticks: 60, timerId: 'pulse' },
      }),
    ],
  }),
];

export const BehaviorDiagnosticSeverity = Schema.Literals(['error', 'warning', 'info']);
export type BehaviorDiagnosticSeverity = typeof BehaviorDiagnosticSeverity.Type;

/**
 * Core diagnostic data. Desktop maps this into the existing ReadinessDiagnostic
 * contract; core does not own or duplicate the renderer-facing readiness report.
 */
export class BehaviorDiagnostic extends Schema.Class<BehaviorDiagnostic>('BehaviorDiagnostic')({
  id: Schema.String,
  code: Schema.String,
  severity: BehaviorDiagnosticSeverity,
  title: Schema.String,
  message: Schema.String,
  behaviorId: Schema.optional(BehaviorId),
  sourceKind: Schema.optional(BehaviorSourceKind),
  nodeId: Schema.optional(BehaviorNodeId),
  path: Schema.optional(Schema.String),
  registryEntryId: Schema.optional(BehaviorRegistryEntryId),
  reference: Schema.optional(BehaviorReference),
  details: Schema.optional(JsonObject),
}) {}

export class UnsupportedBehaviorSchemaVersionError extends Schema.TaggedErrorClass<UnsupportedBehaviorSchemaVersionError>()(
  'UnsupportedBehaviorSchemaVersionError',
  {
    schemaVersion: Schema.Number,
    supportedVersion: Schema.Literal(BEHAVIOR_DEFINITION_SCHEMA_VERSION),
    message: Schema.String,
  },
) {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Canonical persisted-definition boundary. New versions must add an explicit,
 * sequential migration here; unknown/future versions fail instead of guessing.
 */
export const migrateBehaviorDefinitionJson = (value: unknown): unknown => {
  if (!isRecord(value) || typeof value.schemaVersion !== 'number') return value;
  if (value.schemaVersion === BEHAVIOR_DEFINITION_SCHEMA_VERSION) return value;
  throw new UnsupportedBehaviorSchemaVersionError({
    schemaVersion: value.schemaVersion,
    supportedVersion: BEHAVIOR_DEFINITION_SCHEMA_VERSION,
    message: `behavior schema version ${value.schemaVersion} is not supported; expected ${BEHAVIOR_DEFINITION_SCHEMA_VERSION}`,
  });
};

export const decodePersistedBehaviorDefinitionJson = (value: unknown): BehaviorDefinition =>
  Schema.decodeUnknownSync(BehaviorDefinition)(migrateBehaviorDefinitionJson(value));
