# Review Artifact

- Generated: 2026-07-13T16:52:26.709881Z
- Review item: i-review-unify-readiness-diagnosti-f193 (closed)
- Review title: Review Unify readiness diagnostics and gate every execution path
- Target item: i-unify-readiness-diagnostics-and-d543 (in_review)
- Target title: Unify readiness diagnostics and gate every execution path
- Verdict: not-complete
- Reviewer: reviewer-br-readiness
- Review mode: independent

## Findings

- [P0] Preserve source diagnostic severities end to end. apps/desktop readiness currently maps every PACK.unsupported-schema capability diagnostic to error even when the SDK emitted warning; live CDP showed fallback warnings such as No positive variant weights and unknown autotile tiles hard-blocking Playtest and Build. Add severity-preserving contracts and regression tests. [P0] Aggregate the existing detailed visual-model policy, semantic ref, required clip, and referenced-asset diagnostics in the canonical main-process readiness service. The new gate only checks whether the resolved BR roster is empty, while TopBar no longer runs useVisualModelDiagnostics, so invalid or incomplete visual models are omitted from execution gates. Add handler-level gate tests. [P1] Keep readiness queries coherent after every mutation of owned prerequisite state. Generate/import/set-tileset map flows, asset pack install/remove/import, catalog import, plugin install/enable/disable, and plugin editor commands do not consistently invalidate queryKeys.readiness, leaving Problems/TopBar stale and potentially blocking a repaired project or showing ready while the main gate rejects. Add focused invalidation tests. [P1] Finish the promised readiness consumers and actionable deep links. TASK-001 names the creator checklist, but Project Overview has no checklist/useReadiness consumer; catalog diagnostics carry objectTypeId but Problems ignores it, and no producer/test proves map-object selection. Add the derived checklist, object-level navigation where identifiers exist, and focused renderer/integration coverage for every Playtest/Build entry point.

## Annotations

- None recorded

## Review Logs

- log-32a66d26: review verdict: not-complete (reviewer: reviewer-br-readiness, mode: independent)

## Git And PR Evidence

- Source content included: false
- Agent-owned files: ["apps/desktop/src/main/ipc/handlers.ts","apps/desktop/src/main/readiness.test.ts","apps/desktop/src/main/readiness.ts","apps/desktop/src/renderer/components/bottom-drawer/bottom-drawer.tsx","apps/desktop/src/renderer/components/bottom-drawer/problems-tab.test.tsx","apps/desktop/src/renderer/components/bottom-drawer/problems-tab.tsx","apps/desktop/src/renderer/components/shell/command-palette.tsx","apps/desktop/src/renderer/components/shell/top-bar.tsx","apps/desktop/src/renderer/hooks/mutations.ts","apps/desktop/src/renderer/hooks/queries.ts","apps/desktop/src/renderer/lib/bridge-types.ts","apps/desktop/src/renderer/lib/query-client.ts","apps/desktop/src/renderer/lib/readiness-gate.test.ts","apps/desktop/src/renderer/lib/readiness-gate.ts","packages/ipc-contracts/src/codegen-shape.ts","packages/ipc-contracts/src/contracts.test.ts","packages/ipc-contracts/src/contracts/index.ts","packages/ipc-contracts/src/contracts/main-registry.ts","packages/ipc-contracts/src/contracts/readiness.test.ts","packages/ipc-contracts/src/contracts/readiness.ts"]
- Scoped changed files: ["apps/desktop/src/main/ipc/handlers.ts","apps/desktop/src/main/readiness.test.ts","apps/desktop/src/main/readiness.ts","apps/desktop/src/renderer/components/bottom-drawer/bottom-drawer.tsx","apps/desktop/src/renderer/components/bottom-drawer/problems-tab.test.tsx","apps/desktop/src/renderer/components/bottom-drawer/problems-tab.tsx","apps/desktop/src/renderer/components/shell/command-palette.tsx","apps/desktop/src/renderer/components/shell/top-bar.tsx","apps/desktop/src/renderer/hooks/mutations.ts","apps/desktop/src/renderer/hooks/queries.ts","apps/desktop/src/renderer/lib/bridge-types.ts","apps/desktop/src/renderer/lib/query-client.ts","apps/desktop/src/renderer/lib/readiness-gate.test.ts","apps/desktop/src/renderer/lib/readiness-gate.ts","packages/ipc-contracts/src/codegen-shape.ts","packages/ipc-contracts/src/contracts.test.ts","packages/ipc-contracts/src/contracts/index.ts","packages/ipc-contracts/src/contracts/main-registry.ts","packages/ipc-contracts/src/contracts/readiness.test.ts","packages/ipc-contracts/src/contracts/readiness.ts"]
- Unrelated dirty files: [".claude/",".codex/",".planr/","apps/desktop/src/renderer/components/map-editor-viewport.test.tsx","apps/desktop/src/renderer/components/map-editor-viewport.tsx","apps/desktop/src/renderer/components/sidebar/working-palette-sidebar.test.tsx","apps/desktop/src/renderer/components/sidebar/working-palette-sidebar.tsx","apps/desktop/src/renderer/editor/viewport/editor-viewport-controller.test.ts","apps/desktop/src/renderer/editor/viewport/editor-viewport-controller.ts","apps/desktop/src/renderer/editor/viewport/viewport-asset-manifest.test.ts","apps/desktop/src/renderer/editor/viewport/viewport-asset-manifest.ts","apps/desktop/src/renderer/hooks/asset-library-queries.test.tsx"]
- PR URLs: []

## Follow-up Work

- i-fix-findings-for-review-unify-re-c75d [fix] Fix findings for Review Unify readiness diagnostics and gate every execution path
- i-follow-up-review-for-review-unif-d126 [review] Follow-up review for Review Unify readiness diagnostics and gate every execution path

## Privacy

- Source file content included: false
- Prompt or response content included: false
