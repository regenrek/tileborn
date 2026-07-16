import { Schema } from 'effect';

import { ContentHash } from '@tileborne/core';
import {
  ContradictoryRuleError,
  TiledSourceRulePipeline,
  TiledSourceTiledSourceManifest,
  TiledSourceRuleApplicationInput,
  TiledSourceRuleApplicationOutput,
  TiledSourceRuleDiagnostic,
  InvalidRuleOptionError,
  InvalidSourceManifestError,
  MissingTilesetError,
  SourceDigest,
  SourceManifestId,
} from '@tileborne/sdk-tileset/tiled-source-rules';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { IpcContractErrors } from './common.js';

export const TiledSourceRulesContractErrors = Schema.Union([
  IpcContractErrors,
  InvalidSourceManifestError,
  MissingTilesetError,
  InvalidRuleOptionError,
  ContradictoryRuleError,
]);

export class TiledSourceRulesCompilePreviewRequest extends Schema.Class<TiledSourceRulesCompilePreviewRequest>(
  'TiledSourceRulesCompilePreviewRequest',
)({
  manifestId: SourceManifestId,
  manifest: TiledSourceTiledSourceManifest,
  includeDiagnostics: Schema.OptionFromOptional(Schema.Boolean),
}) {}

export class TiledSourceRulesCompilePreviewResponse extends Schema.Class<TiledSourceRulesCompilePreviewResponse>(
  'TiledSourceRulesCompilePreviewResponse',
)({
  manifestId: SourceManifestId,
  sourceDigest: SourceDigest,
  pipeline: TiledSourceRulePipeline,
  diagnostics: Schema.Array(TiledSourceRuleDiagnostic),
}) {}

export class TiledSourceRulesRuntimeApplyRequest extends Schema.Class<TiledSourceRulesRuntimeApplyRequest>(
  'TiledSourceRulesRuntimeApplyRequest',
)({
  manifestId: SourceManifestId,
  pipeline: TiledSourceRulePipeline,
  input: TiledSourceRuleApplicationInput,
}) {}

export class TiledSourceRulesRuntimeApplyResponse extends Schema.Class<TiledSourceRulesRuntimeApplyResponse>(
  'TiledSourceRulesRuntimeApplyResponse',
)({
  manifestId: SourceManifestId,
  sourceDigest: SourceDigest,
  output: TiledSourceRuleApplicationOutput,
}) {}

export const TiledSourceRulesProgressStage = Schema.Literals([
  'queued',
  'validating-source',
  'compiling-rules',
  'projecting-runtime',
  'completed',
  'failed',
] as const);

export class TiledSourceRulesCompileProgressEventPayload extends Schema.Class<TiledSourceRulesCompileProgressEventPayload>(
  'TiledSourceRulesCompileProgressEventPayload',
)({
  manifestId: SourceManifestId,
  sourceDigest: Schema.OptionFromOptional(SourceDigest),
  stage: TiledSourceRulesProgressStage,
  completedSteps: Schema.OptionFromOptional(Schema.Number),
  totalSteps: Schema.OptionFromOptional(Schema.Number),
  message: Schema.OptionFromOptional(Schema.String),
}) {}

export class TiledSourceRulesRuntimeApplyProgressEventPayload extends Schema.Class<TiledSourceRulesRuntimeApplyProgressEventPayload>(
  'TiledSourceRulesRuntimeApplyProgressEventPayload',
)({
  manifestId: SourceManifestId,
  sourceDigest: SourceDigest,
  pipelineDigest: ContentHash,
  stage: TiledSourceRulesProgressStage,
  completedSteps: Schema.OptionFromOptional(Schema.Number),
  totalSteps: Schema.OptionFromOptional(Schema.Number),
  message: Schema.OptionFromOptional(Schema.String),
}) {}

export const TiledSourceRulesDiagnosticsScope = Schema.Literals([
  'compile-preview',
  'runtime-apply',
] as const);

export class TiledSourceRulesDiagnosticsEventPayload extends Schema.Class<TiledSourceRulesDiagnosticsEventPayload>(
  'TiledSourceRulesDiagnosticsEventPayload',
)({
  manifestId: SourceManifestId,
  sourceDigest: Schema.OptionFromOptional(SourceDigest),
  pipelineDigest: Schema.OptionFromOptional(ContentHash),
  scope: TiledSourceRulesDiagnosticsScope,
  diagnostics: Schema.Array(TiledSourceRuleDiagnostic),
}) {}

export const TiledSourceRulesCompilePreviewContract = defineContract({
  channel: 'tileborne:tiled-source-rules:compilePreview',
  request: TiledSourceRulesCompilePreviewRequest,
  response: TiledSourceRulesCompilePreviewResponse,
  errors: TiledSourceRulesContractErrors,
});

export const TiledSourceRulesRuntimeApplyContract = defineContract({
  channel: 'tileborne:tiled-source-rules:runtimeApply',
  request: TiledSourceRulesRuntimeApplyRequest,
  response: TiledSourceRulesRuntimeApplyResponse,
  errors: TiledSourceRulesContractErrors,
});

export const TiledSourceRulesContracts = [
  TiledSourceRulesCompilePreviewContract,
  TiledSourceRulesRuntimeApplyContract,
] as const;

export const TiledSourceRulesIpcRegistry = createRegistry(TiledSourceRulesContracts);
