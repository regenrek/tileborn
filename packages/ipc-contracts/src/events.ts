import { Schema } from "effect";

import { createEventRegistry, defineEvent, type IpcEventRegistry } from "./events-core.js";
import { Uint8ArraySchema } from "./bytes.js";

export * from "./events-core.js";
export { TriggerEventPayload } from "./contracts/trigger.js";

import { AssetsCapabilityRefreshedEventPayload } from "./contracts/assets.js";
import {
  TiledSourceRulesCompileProgressEventPayload,
  TiledSourceRulesDiagnosticsEventPayload,
  TiledSourceRulesRuntimeApplyProgressEventPayload,
} from "./contracts/tiled-source-rules.js";
import { TriggerEventPayload } from "./contracts/trigger.js";

/**
 * Payload for `tileborne:runtime:snapshot`. The runtime worker forwards opaque
 * plugin-encoded snapshot frames (e.g. BattleRoyaleProtocol welcome/delta) to
 * the renderer; the shell treats `frame` as unknown bytes and lets the active
 * plugin's projector narrow them. See ADR-0014.
 */
export const RuntimeSnapshotEventPayload = Schema.Struct({
  sessionId: Schema.String,
  frame: Uint8ArraySchema,
});

export type RuntimeSnapshotEventPayload = Schema.Schema.Type<typeof RuntimeSnapshotEventPayload>;

export const ProjectsChangedEvent = defineEvent({
  channel: "tileborne:projects:changed",
  payload: TriggerEventPayload,
});

export const MapsChangedEvent = defineEvent({
  channel: "tileborne:maps:changed",
  payload: TriggerEventPayload,
});

export const AssetsChangedEvent = defineEvent({
  channel: "tileborne:assets:changed",
  payload: TriggerEventPayload,
});

export const AssetsCapabilityRefreshedEvent = defineEvent({
  channel: "tileborne:assets:capabilityRefreshed",
  payload: AssetsCapabilityRefreshedEventPayload,
});

export const PluginsChangedEvent = defineEvent({
  channel: "tileborne:plugins:changed",
  payload: TriggerEventPayload,
});

export const JobsChangedEvent = defineEvent({
  channel: "tileborne:jobs:changed",
  payload: TriggerEventPayload,
});

export const BuildsChangedEvent = defineEvent({
  channel: "tileborne:builds:changed",
  payload: TriggerEventPayload,
});

export const ExportsChangedEvent = defineEvent({
  channel: "tileborne:exports:changed",
  payload: TriggerEventPayload,
});

export const PlaytestChangedEvent = defineEvent({
  channel: "tileborne:playtest:changed",
  payload: TriggerEventPayload,
});

export const DeploymentsChangedEvent = defineEvent({
  channel: "tileborne:deployments:changed",
  payload: TriggerEventPayload,
});

export const SupportChangedEvent = defineEvent({
  channel: "tileborne:support:changed",
  payload: TriggerEventPayload,
});

export const LogsAppendedEvent = defineEvent({
  channel: "tileborne:logs:appended",
  payload: TriggerEventPayload,
});

export const RuntimeSnapshotEvent = defineEvent({
  channel: "tileborne:runtime:snapshot",
  payload: RuntimeSnapshotEventPayload,
});

export const TiledSourceRulesCompileProgressEvent = defineEvent({
  channel: "tileborne:tiled-source-rules:compile-progress",
  payload: TiledSourceRulesCompileProgressEventPayload,
});

export const TiledSourceRulesRuntimeApplyProgressEvent = defineEvent({
  channel: "tileborne:tiled-source-rules:runtime-apply-progress",
  payload: TiledSourceRulesRuntimeApplyProgressEventPayload,
});

export const TiledSourceRulesDiagnosticsEvent = defineEvent({
  channel: "tileborne:tiled-source-rules:diagnostics",
  payload: TiledSourceRulesDiagnosticsEventPayload,
});

export const MainIpcEvents = [
  ProjectsChangedEvent,
  MapsChangedEvent,
  AssetsChangedEvent,
  AssetsCapabilityRefreshedEvent,
  PluginsChangedEvent,
  JobsChangedEvent,
  BuildsChangedEvent,
  ExportsChangedEvent,
  PlaytestChangedEvent,
  DeploymentsChangedEvent,
  SupportChangedEvent,
  LogsAppendedEvent,
  RuntimeSnapshotEvent,
  TiledSourceRulesCompileProgressEvent,
  TiledSourceRulesRuntimeApplyProgressEvent,
  TiledSourceRulesDiagnosticsEvent,
] as const;

export type MainEventRegistry = IpcEventRegistry<typeof MainIpcEvents>;

export const MainEventRegistry = createEventRegistry(MainIpcEvents);
