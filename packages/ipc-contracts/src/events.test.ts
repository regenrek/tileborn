import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  AssetsCapabilityRefreshedEvent,
  TiledSourceRulesCompileProgressEvent,
  TiledSourceRulesDiagnosticsEvent,
  TiledSourceRulesRuntimeApplyProgressEvent,
  MainEventRegistry,
  MainIpcEvents,
  RuntimeSnapshotEvent,
} from "./events.ts";

describe("IPC events", () => {
  it("exports the main trigger-only event registry", () => {
    expect(MainIpcEvents).toHaveLength(16);
    expect(MainEventRegistry.byChannel["tileborne:projects:changed"]).toBeDefined();
    expect(MainEventRegistry.byChannel["tileborne:logs:appended"]).toBeDefined();
    expect(MainEventRegistry.byChannel["tileborne:assets:capabilityRefreshed"]).toBe(AssetsCapabilityRefreshedEvent);
    expect(MainEventRegistry.byChannel["tileborne:runtime:snapshot"]).toBe(RuntimeSnapshotEvent);
    expect(MainEventRegistry.byChannel["tileborne:tiled-source-rules:compile-progress"]).toBe(
      TiledSourceRulesCompileProgressEvent,
    );
    expect(MainEventRegistry.byChannel["tileborne:tiled-source-rules:runtime-apply-progress"]).toBe(
      TiledSourceRulesRuntimeApplyProgressEvent,
    );
    expect(MainEventRegistry.byChannel["tileborne:tiled-source-rules:diagnostics"]).toBe(
      TiledSourceRulesDiagnosticsEvent,
    );
    expect(
      Schema.decodeUnknownSync(RuntimeSnapshotEvent.payload)({
        sessionId: "session-1",
        frame: new Uint8Array([1, 2, 3]),
      }),
    ).toMatchObject({
      sessionId: "session-1",
      frame: new Uint8Array([1, 2, 3]),
    });
  });
});
