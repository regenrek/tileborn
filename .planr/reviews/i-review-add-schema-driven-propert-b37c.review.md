# Review Artifact

- Generated: 2026-07-13T19:11:03.91657Z
- Review item: i-review-add-schema-driven-propert-b37c (closed)
- Review title: Review Add schema-driven properties and canonical project content
- Target item: i-add-schema-driven-properties-and-053f (in_review)
- Target title: Add schema-driven properties and canonical project content
- Verdict: not-complete
- Reviewer: reviewer-br-readiness
- Review mode: independent

## Findings

- [P0] Shared effective content is not actually consumed by playtest/build: project weapon definitions are reduced to weaponIds and ignored as runtime data, while project items and loot tables are dropped entirely. Carry the effective versioned definitions through CatalogService runtime sources, map-package assembly, playtest and build, and prove a project-authored weapon/item/loot definition changes the executed runtime snapshot/behavior. [P1] Reference-safe delete is incomplete: CatalogService.removeDefinition scans only ProjectContentDocument and cannot detect MapObject.kind references in project maps; it also treats an ID found under a different kind as a successful removal. Add one canonical reference graph spanning maps and all authored definitions, enforce kind/id pairing, and test blocked deletion plus repair semantics. [P1] Schema target=asset is not authorable: EntityCapabilityPanel supplies reference options for entity/weapon/item/loot-table but no assets, so the generic asset-reference control renders an empty select. Wire a discoverable bounded asset picker into the recursive renderer and cover it with renderer/live tests. [P1] Provenance is not consistently exposed or enforced: persisted provenance is projected for weapons only, while project object/item/loot resolved DTOs drop it and imports can omit provenance entries. Enforce complete provenance on import/duplicate/export and expose origin/template metadata consistently for every project definition.

## Annotations

- None recorded

## Review Logs

- log-31511708: review verdict: not-complete (reviewer: reviewer-br-readiness, mode: independent)

## Git And PR Evidence

- Source content included: false
- Agent-owned files: ["/tmp/tileborne-task002-live-final.png","apps/desktop/src/main/catalog/catalog-service.test.ts","apps/desktop/src/main/catalog/catalog-service.ts","apps/desktop/src/main/ipc/handlers.ts","apps/desktop/src/renderer/components/authoring/schema-field-controls.test.tsx","apps/desktop/src/renderer/components/authoring/schema-field-controls.tsx","apps/desktop/src/renderer/components/entity-editor/entity-capability-panel.tsx","apps/desktop/src/renderer/lib/entity-authoring.ts","apps/desktop/src/renderer/routes/entity-editor-page.tsx","packages/core/src/authoring/field-schema.ts","packages/core/src/authoring/index.ts","packages/core/src/catalog/object-type.ts","packages/core/src/catalog/validate.ts","packages/core/src/index.ts","packages/ipc-contracts/src/codegen-shape.ts","packages/ipc-contracts/src/contracts/catalog.test.ts","packages/ipc-contracts/src/contracts/catalog.ts","packages/ipc-contracts/src/contracts/main-registry.ts","packages/plugin-api/src/catalog-registry.test.ts","packages/plugin-api/src/catalog-registry.ts","packages/plugin-api/src/index.ts","packages/plugin-api/src/project-content.test.ts","packages/plugin-api/src/project-content.ts","packages/services-build/src/build/index.ts"]
- Scoped changed files: ["apps/desktop/src/main/catalog/catalog-service.test.ts","apps/desktop/src/main/catalog/catalog-service.ts","apps/desktop/src/main/ipc/handlers.ts","apps/desktop/src/renderer/components/entity-editor/entity-capability-panel.tsx","apps/desktop/src/renderer/lib/entity-authoring.ts","apps/desktop/src/renderer/routes/entity-editor-page.tsx","packages/core/src/catalog/object-type.ts","packages/core/src/catalog/validate.ts","packages/core/src/index.ts","packages/ipc-contracts/src/codegen-shape.ts","packages/ipc-contracts/src/contracts/catalog.test.ts","packages/ipc-contracts/src/contracts/catalog.ts","packages/ipc-contracts/src/contracts/main-registry.ts","packages/plugin-api/src/catalog-registry.test.ts","packages/plugin-api/src/catalog-registry.ts","packages/plugin-api/src/index.ts","packages/plugin-api/src/project-content.test.ts","packages/plugin-api/src/project-content.ts","packages/services-build/src/build/index.ts"]
- Unrelated dirty files: [".claude/",".codex/",".planr/","apps/desktop/src/main/readiness.test.ts","apps/desktop/src/main/readiness.ts","apps/desktop/src/renderer/components/authoring/","apps/desktop/src/renderer/components/bottom-drawer/bottom-drawer.tsx","apps/desktop/src/renderer/components/bottom-drawer/problems-tab.test.tsx","apps/desktop/src/renderer/components/bottom-drawer/problems-tab.tsx","apps/desktop/src/renderer/components/map-editor-viewport.test.tsx","apps/desktop/src/renderer/components/map-editor-viewport.tsx","apps/desktop/src/renderer/components/shell/app-shell.tsx","apps/desktop/src/renderer/components/shell/command-palette.tsx","apps/desktop/src/renderer/components/shell/top-bar.tsx","apps/desktop/src/renderer/components/sidebar/working-palette-sidebar.test.tsx","apps/desktop/src/renderer/components/sidebar/working-palette-sidebar.tsx","apps/desktop/src/renderer/editor/viewport/editor-viewport-controller.test.ts","apps/desktop/src/renderer/editor/viewport/editor-viewport-controller.ts","apps/desktop/src/renderer/editor/viewport/viewport-asset-manifest.test.ts","apps/desktop/src/renderer/editor/viewport/viewport-asset-manifest.ts","apps/desktop/src/renderer/hooks/asset-library-queries.test.tsx","apps/desktop/src/renderer/hooks/catalog-validation-queries.test.tsx","apps/desktop/src/renderer/hooks/mutations.test.tsx","apps/desktop/src/renderer/hooks/mutations.ts","apps/desktop/src/renderer/hooks/queries.ts","apps/desktop/src/renderer/hooks/use-event-invalidations.ts","apps/desktop/src/renderer/hooks/use-readiness-problems-owner.test.tsx","apps/desktop/src/renderer/hooks/use-readiness-problems-owner.ts","apps/desktop/src/renderer/lib/bridge-types.ts","apps/desktop/src/renderer/lib/creator-readiness-checklist.test.ts","apps/desktop/src/renderer/lib/creator-readiness-checklist.ts","apps/desktop/src/renderer/lib/query-client.ts","apps/desktop/src/renderer/lib/readiness-gate.test.ts","apps/desktop/src/renderer/lib/readiness-gate.ts","apps/desktop/src/renderer/lib/tileborne-bridge.test.ts","apps/desktop/src/renderer/lib/visual-model-diagnostics.ts","apps/desktop/src/renderer/routes/project-overview-page.tsx","apps/desktop/src/renderer/stores/editor-ui-store.ts","apps/desktop/src/shared/visual-model-diagnostics.ts","packages/core/src/asset/pack-capability.ts","packages/core/src/authoring/","packages/core/src/schemas.test.ts","packages/ipc-contracts/src/contracts.test.ts","packages/ipc-contracts/src/contracts/assets.test.ts","packages/ipc-contracts/src/contracts/index.ts","packages/ipc-contracts/src/contracts/readiness.test.ts","packages/ipc-contracts/src/contracts/readiness.ts","packages/services-app/src/asset-capability.test.ts","packages/services-app/src/asset/capability.ts","packages/services-app/src/asset/index.ts"]
- PR URLs: []

## Follow-up Work

- i-fix-findings-for-review-add-sche-266f [fix] Fix findings for Review Add schema-driven properties and canonical project content
- i-follow-up-review-for-review-add-f513 [review] Follow-up review for Review Add schema-driven properties and canonical project content

## Privacy

- Source file content included: false
- Prompt or response content included: false
