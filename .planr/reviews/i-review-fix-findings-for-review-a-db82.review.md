# Review Artifact

- Generated: 2026-07-13T19:42:13.658611Z
- Review item: i-review-fix-findings-for-review-a-db82 (closed)
- Review title: Review Fix findings for Review Add schema-driven properties and canonical project content
- Target item: i-fix-findings-for-review-add-sche-266f (in_review)
- Target title: Fix findings for Review Add schema-driven properties and canonical project content
- Verdict: not-complete
- Reviewer: reviewer-br-readiness
- Review mode: independent

## Findings

- [P1] The services-build verification gate is not reproducible after the documented workspace check sequence. In this independent run, pnpm -w typecheck completed 42/42 but left apps/game-host/dist/worker.js as unbundled TypeScript output importing Hono from hono. The immediately following unsandboxed pnpm --filter @tileborne/services-build test failed all three local-game-host smokes with Miniflare ERR_MODULE_RULE for hono, with 62/65 passing. Running pnpm --filter @tileborne/game-host build restored the bundled worker, after which the same full services-build suite passed 65/65. Separately, sandboxed runs time out because localhost listen is denied with EPERM; the focused test passes 3/3 unsandboxed. Make the services-build test/build pipeline hermetic so it prepares or depends on the bundled game-host worker and cannot be invalidated by workspace typecheck or reference builds, then add a regression or CI sequence that runs workspace typecheck followed directly by the full services-build suite.

## Annotations

- None recorded

## Review Logs

- log-c4a7eef2: review verdict: not-complete (reviewer: reviewer-br-readiness, mode: independent)

## Git And PR Evidence

- Source content included: false
- Agent-owned files: ["apps/desktop/src/main/catalog/catalog-service.test.ts","apps/desktop/src/main/catalog/catalog-service.ts","apps/desktop/src/main/ipc/handlers.ts","apps/desktop/src/renderer/components/entity-editor/entity-capability-panel.tsx","apps/desktop/src/renderer/routes/entity-editor-page.tsx","apps/game-host/scripts/generate-bundled-map-packages.mjs","packages/core/src/map-package/index.ts","packages/ipc-contracts/src/contracts/catalog.ts","packages/plugin-api/src/project-content.test.ts","packages/plugin-api/src/project-content.ts","packages/plugin-battle-royale/src/runtime-state-from-package.ts","packages/plugin-battle-royale/src/weapon-catalog.ts","packages/runtime/src/map-package/loader.ts","packages/services-build/src/map-package/assemble.ts"]
- Scoped changed files: ["apps/desktop/src/main/catalog/catalog-service.test.ts","apps/desktop/src/main/catalog/catalog-service.ts","apps/desktop/src/main/ipc/handlers.ts","apps/desktop/src/renderer/components/entity-editor/entity-capability-panel.tsx","apps/desktop/src/renderer/routes/entity-editor-page.tsx","apps/game-host/scripts/generate-bundled-map-packages.mjs","packages/core/src/map-package/index.ts","packages/ipc-contracts/src/contracts/catalog.ts","packages/plugin-api/src/project-content.test.ts","packages/plugin-api/src/project-content.ts","packages/plugin-battle-royale/src/runtime-state-from-package.ts","packages/plugin-battle-royale/src/weapon-catalog.ts","packages/runtime/src/map-package/loader.ts","packages/services-build/src/map-package/assemble.ts"]
- Unrelated dirty files: [".claude/",".codex/",".planr/","apps/desktop/src/main/readiness.test.ts","apps/desktop/src/main/readiness.ts","apps/desktop/src/renderer/components/authoring/","apps/desktop/src/renderer/components/bottom-drawer/bottom-drawer.tsx","apps/desktop/src/renderer/components/bottom-drawer/problems-tab.test.tsx","apps/desktop/src/renderer/components/bottom-drawer/problems-tab.tsx","apps/desktop/src/renderer/components/map-editor-viewport.test.tsx","apps/desktop/src/renderer/components/map-editor-viewport.tsx","apps/desktop/src/renderer/components/shell/app-shell.tsx","apps/desktop/src/renderer/components/shell/command-palette.tsx","apps/desktop/src/renderer/components/shell/top-bar.tsx","apps/desktop/src/renderer/components/sidebar/working-palette-sidebar.test.tsx","apps/desktop/src/renderer/components/sidebar/working-palette-sidebar.tsx","apps/desktop/src/renderer/editor/viewport/editor-viewport-controller.test.ts","apps/desktop/src/renderer/editor/viewport/editor-viewport-controller.ts","apps/desktop/src/renderer/editor/viewport/viewport-asset-manifest.test.ts","apps/desktop/src/renderer/editor/viewport/viewport-asset-manifest.ts","apps/desktop/src/renderer/hooks/asset-library-queries.test.tsx","apps/desktop/src/renderer/hooks/catalog-validation-queries.test.tsx","apps/desktop/src/renderer/hooks/mutations.test.tsx","apps/desktop/src/renderer/hooks/mutations.ts","apps/desktop/src/renderer/hooks/queries.ts","apps/desktop/src/renderer/hooks/use-event-invalidations.ts","apps/desktop/src/renderer/hooks/use-readiness-problems-owner.test.tsx","apps/desktop/src/renderer/hooks/use-readiness-problems-owner.ts","apps/desktop/src/renderer/lib/bridge-types.ts","apps/desktop/src/renderer/lib/creator-readiness-checklist.test.ts","apps/desktop/src/renderer/lib/creator-readiness-checklist.ts","apps/desktop/src/renderer/lib/entity-authoring.ts","apps/desktop/src/renderer/lib/query-client.ts","apps/desktop/src/renderer/lib/readiness-gate.test.ts","apps/desktop/src/renderer/lib/readiness-gate.ts","apps/desktop/src/renderer/lib/tileborne-bridge.test.ts","apps/desktop/src/renderer/lib/visual-model-diagnostics.ts","apps/desktop/src/renderer/routes/entity-editor-page.test.tsx","apps/desktop/src/renderer/routes/project-overview-page.tsx","apps/desktop/src/renderer/stores/editor-ui-store.ts","apps/desktop/src/shared/visual-model-diagnostics.ts","packages/core/src/asset/pack-capability.ts","packages/core/src/authoring/","packages/core/src/catalog/object-type.ts","packages/core/src/catalog/validate.ts","packages/core/src/index.ts","packages/core/src/map-package/index.test.ts","packages/core/src/schemas.test.ts","packages/ipc-contracts/src/codegen-shape.ts","packages/ipc-contracts/src/contracts.test.ts","packages/ipc-contracts/src/contracts/assets.test.ts","packages/ipc-contracts/src/contracts/catalog.test.ts","packages/ipc-contracts/src/contracts/index.ts","packages/ipc-contracts/src/contracts/main-registry.ts","packages/ipc-contracts/src/contracts/readiness.test.ts","packages/ipc-contracts/src/contracts/readiness.ts","packages/plugin-api/package.json","packages/plugin-api/src/catalog-registry.test.ts","packages/plugin-api/src/catalog-registry.ts","packages/plugin-api/src/index.ts","packages/plugin-battle-royale/src/runtime-adapter.ts","packages/plugin-battle-royale/src/runtime-state-from-package.test.ts","packages/plugin-battle-royale/src/test-map-package.ts","packages/plugin-battle-royale/tsup.config.ts","packages/runtime/src/map-package/loader.test.ts","packages/services-app/src/asset-capability.test.ts","packages/services-app/src/asset/capability.ts","packages/services-app/src/asset/index.ts","packages/services-build/src/build/index.ts","packages/services-build/src/map-package/assemble.test.ts","tsconfig.base.json"]
- PR URLs: []

## Follow-up Work

- i-fix-findings-for-review-fix-find-9a84 [fix] Fix findings for Review Fix findings for Review Add schema-driven properties and canonical project content
- i-follow-up-review-for-review-fix-0efa [review] Follow-up review for Review Fix findings for Review Add schema-driven properties and canonical project content

## Privacy

- Source file content included: false
- Prompt or response content included: false
