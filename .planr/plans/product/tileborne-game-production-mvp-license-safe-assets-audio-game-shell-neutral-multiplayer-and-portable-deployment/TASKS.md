# Tasks

### TASK-001: Audit and enforce license-safe shipped assets

Goal: Establish one canonical provenance and redistribution gate for bundled,
sample, imported, generated, and project-private assets.

Acceptance criteria:
- Every shipped/sample asset is inventoried; unclear or incompatible assets such as ancient-runes-style packs are removed, replaced, or explicitly excluded from distributable output.
- License, source, attribution, modification, and redistribution fields have one schema owner and survive import, persistence, readiness, and packaging.
- Ship fails closed on unknown/disallowed licenses with actionable editor navigation.
- BetterLeaks/Trivy-style release scans and focused schema/readiness/package tests are logged.

### TASK-002: Deliver the essential audio authoring and runtime MVP

Goal: Make music and SFX usable end to end without implementing an advanced mixer.

Acceptance criteria:
- Creators can import, preview, classify, bind, replace, and remove audio by labels rather than raw ids.
- Typed bindings cover shell music plus representative weapon, item, player, environment, and match events.
- Runtime supports play/stop/loop, music and SFX volume, mute, sensible overlap limits, missing-source diagnostics, and packaged playback.
- Audio commands are testable/deterministic while playback stays a client-side effect.

### TASK-003: Create the declarative Game Shell contract and editor

Goal: Let projects compose polished game-facing screens from schemas and visual controls.

Acceptance criteria:
- Title, main menu, loading, pause, settings, and results schemas have stable ids, versioning, validation, persistence, preview, and plugin defaults/project overrides.
- The editor exposes free-font/background asset pickers, text, layout/design tokens, screen order, and typed actions with no JSON editing.
- Navigation actions are declarative; SDK/visual behaviors can consume and emit registered shell events without owning router internals.
- Invalid routes, missing assets/fonts, and unreachable required screens block readiness with deep links.

### TASK-004: Integrate accessible shell runtime and game flow

Goal: Execute the authored shell consistently in editor playtest and shipped clients.

Acceptance criteria:
- Keyboard, mouse, and gamepad provide deterministic focus/navigation with visible focus, Escape/Back policy, reduced motion, and accessible names/status.
- Pause/resume, settings persistence, lobby transition, match loading, terminal results, retry, and exit/back flows use one runtime state owner.
- Shell audio bindings and game-mode-provided result data render without BR literals in neutral UI packages.
- Live Electron and shipped-client tests cover the complete screen flow and recovery from missing/failed resources.

### TASK-005: Extract genre-neutral multiplayer capabilities

Goal: Make existing proven multiplayer lifecycle reusable by other game types while Battle Royale retains its rules.

Acceptance criteria:
- Neutral typed contracts/services own host/join, private room code, lobby readiness, participant/owner roles, reconnect, start/stop, results, diagnostics, and metrics.
- BR implements mode-specific match rules through the neutral boundary; no generic package imports BR internals.
- Example Arena or a dedicated fixture proves a second game mode can use the same multiplayer flow and shipped host.
- Existing two-client BR semantics, owner/participant separation, reconnect, durable results, and security limits remain green.

### TASK-006: Add portable deployment with an Alchemy adapter

Goal: Allow local builds and bring-your-own-cloud deployment without encoding Cloudflare policy in core.

Acceptance criteria:
- Ship output includes a versioned provider-neutral deployment manifest and adapter interface.
- Local remains the default adapter; Alchemy is the first external adapter and deploys to Cloudflare using provider-native credentials.
- Direct Wrangler calls/config ownership do not escape the Alchemy/Cloudflare adapter; an AWS adapter can be added later without changing project/game contracts.
- Plan/preview/deploy/status/logs/destroy errors are typed and redacted; deployment never persists credentials in project, artifact, logs, or receipts.

### TASK-007: Build the complete reference game through public workflows

Goal: Dogfood the new layers in one cohesive, content-complete Battle Royale reference game.

Acceptance criteria:
- Only public editor, SDK, plugin, CLI, and deployment surfaces are used; no manual JSON or engine-internal imports.
- Approved assets, branded shell, music, weapon/item/environment SFX, authored behaviors, multiplayer lobby, match, and results are present.
- Single and two-client local playtests complete and the copied Ship artifact executes outside workspace resolution.
- Every required workaround becomes a fixed product gap or an explicit reviewed non-goal before closure.

### TASK-008: Migrate the Cloudflare deployment adapter to Alchemy v2

Goal: Replace the obsolete Alchemy 0.93 deployment path with the supported
Alchemy v2 Effect stack without weakening the provider-neutral deployment
contract.

Acceptance criteria:
- Tileborne uses one pinned Alchemy v2 toolchain compatible with the workspace Effect runtime; the dynamic Alchemy 0.93 `node -e` stack and its local `.alchemy` state ownership are removed.
- A committed, typechecked stack owns the game-host Worker, behavior Worker, PlaytestRoom Durable Object, Worker-to-Worker binding, secret binding, compatibility settings, generated URL, and Cloudflare remote state.
- Provider authentication uses the Alchemy v2 profile/OAuth flow used by the working Planr deployment; credentials remain provider-native and never enter project data, artifacts, state logs, or receipts.
- First create, adopt/redeploy, plan, deploy, failure, status/log limitation, and destroy are covered by focused adapter tests, including a missing Worker/settings response.
- Boundary tests keep Alchemy, Cloudflare, Effect-stack, and provider state details inside the deployment adapter and preserve the provider-neutral manifest/API.

### TASK-009: Prove production readiness and document self-hosting

Goal: Run the full oracle, independent review, security/licensing gates, and user-facing documentation.

Acceptance criteria:
- Automated owner suites, boundaries, typecheck, lint, build, clean checkout, packaged artifact, and security/license gates pass.
- Fresh live Electron evidence covers license failure/repair, audio, shell authoring/navigation, Single, two-client multiplayer, save/reopen, and Ship.
- A copied local artifact boots; a disposable Alchemy deployment in a user-owned Cloudflare account returns real healthy game/room responses and cleanup is evidenced.
- The live Cloudflare proof starts from absent disposable Worker names, deploys both game-host and behavior Workers through Alchemy v2, exercises the authoritative behavior path, and verifies no disposable Worker or deployment state remains after destroy.
- Guides cover local build, Cloudflare deployment, credentials, troubleshooting, licensing, audio, shell, multiplayer extension, and known non-goals.
- An independent review closes complete and `planr plan audit` reports the stored contract holds.
