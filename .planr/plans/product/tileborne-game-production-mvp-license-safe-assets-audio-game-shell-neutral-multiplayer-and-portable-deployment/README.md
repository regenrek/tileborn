# Tileborne Game Production MVP - license-safe assets, audio, game shell, neutral multiplayer, and portable deployment

## Summary

Close the remaining product-facing gaps between Tileborne's proven creator
vertical and a complete distributable local/bring-your-own-cloud game: licensed
content, essential runtime audio, a composable game shell, reusable multiplayer,
and portable deployment. The implementation extends the canonical editor,
runtime, SDK, plugin, Ship Game, and readiness paths instead of creating parallel
stacks.

## Goals

- Make every shipped sample and bundled asset redistributable with machine-checkable provenance.
- Let creators import and bind music and sound effects to gameplay and shell events.
- Let creators compose title, menu, settings, pause, loading, and results screens from project data.
- Extract reusable multiplayer lifecycle capabilities from Battle Royale without moving BR rules into core.
- Ship locally and deploy through a provider-neutral contract, proven by Alchemy against Cloudflare first.
- Prove the result by building, playing, shipping, deploying, and loading one complete reference game.
- Use the supported Alchemy v2 Effect/Cloudflare stack and provider profile; do not retain the obsolete Alchemy 0.93 inline runner as a fallback.

## Non-Goals

- Advanced mixing, spatial/3D audio, DSP, voice chat, or a DAW-style editor.
- Accounts, global matchmaking, parties, friends, progression, leaderboards, anti-cheat, or paid hosted Tileborne service.
- Public plugin marketplace or arbitrary untrusted plugin execution.
- Renaming Battle Royale into a generic multiplayer plugin or placing genre rules in core.
- AWS support in this iteration; the boundary must permit it, but Cloudflare is the first implemented provider.
- Signed/notarized desktop installers, automatic updates, or new desktop OS targets.

## Assumptions

- Existing Battle Royale, behavior authoring, local multiplayer, Ship Game, and recovery goals remain canonical and green.
- Projects may use only assets whose license/provenance permits the intended distribution.
- Creators own their cloud account and credentials; Tileborne does not proxy or retain them.
- Provider authentication may use the local Alchemy v2 OAuth profile; no API token is copied into project or artifact state.
- Free/open fonts, images, music, and effects may be bundled only with compatible licenses and attribution.
- UI navigation is declarative shell data and typed actions; TypeScript/WHEN-IF-DO behaviors may react to shell events but do not own router internals.

## Scope Decision

This is the minimum game-production layer required for a creator to finish a
polished local or self-hosted game. Core owns neutral contracts and deterministic
runtime mechanisms. First-party capability packages own audio, shell, multiplayer,
and deployment integrations. Game-mode plugins own mode rules and contribute
defaults, validators, events, and screen content. Project data owns final branding,
assets, bindings, and deployment configuration.

## Goal Oracle

From a fresh Tileborne Desktop profile, a tester creates or opens the reference
Battle Royale game without editing JSON, uses only license-approved assets,
imports music and item/weapon SFX, authors a branded title/menu/pause/settings/
results shell, runs Single and two-client multiplayer, ships a self-contained
local artifact, executes the copied artifact outside the workspace, then deploys
the same provider-neutral output through Alchemy to a disposable user-owned
Cloudflare target and receives healthy real HTTP/game responses. Readiness blocks
an intentionally unlicensed asset, missing audio binding, invalid shell route,
and invalid multiplayer/deploy configuration with actionable navigation. The
cloud target begins absent, both game-host and behavior Workers are created via
Alchemy v2, authoritative behavior execution is observed, and destroy leaves no
disposable Workers behind.

## Refinement 2026-07-18: Alchemy v2 deployment hard cut

Local evidence identified Tileborne's Alchemy 0.93.7 Worker-settings path as the
source of the first-create failure: a non-JSON 404 loses its status before the
legacy not-found handler can classify the missing behavior Worker. The working
Planr deployment uses Alchemy 2.0 with the Effect stack, Cloudflare providers,
Cloudflare remote state, OAuth profile authentication, and explicit adoption.
Tileborne will migrate to the v2 model as a hard cut and re-run the complete
disposable deployment oracle; this is a product fix, not a sandbox waiver.

## Refinement 2026-07-17T10:59:23.52466Z

User decision: 1.0 must let a knowledgeable creator finish a game, build it locally, and deploy it to their own cloud account; a Tileborne-hosted paid service is deferred until PMF.

## Refinement 2026-07-17T10:59:23.797027Z

User decision: audio is MVP scope now—import and use item, weapon, environment, UI and music sounds; advanced mixer, spatial audio and deep DSP are deferred.

## Refinement 2026-07-17T10:59:24.069054Z

User decision: the game shell must be a composable core/capability module with project/plugin-provided screens, free fonts, background images and menu navigation; it must integrate with the existing typed behavior system without making scripts the router owner.

## Refinement 2026-07-17T10:59:24.34782Z

User decision: do not rename Battle Royale into a generic multiplayer plugin. Separate reusable multiplayer lifecycle capabilities so future multiplayer game types can reuse them while BR keeps its rules.

## Refinement 2026-07-17T10:59:24.617161Z

User decision: avoid a Wrangler/Cloudflare-owned core. Use Alchemy behind a provider-neutral deployment adapter, prove Cloudflare first, and keep future AWS/provider adapters possible.

## Refinement 2026-07-17T10:59:24.879359Z

User decision: public marketplace, paid hosted platform, global accounts/matchmaking/progression and advanced multiplayer ecosystem features are later work, not blockers for this goal.

## Refinement 2026-07-17T10:59:25.151252Z

User requirement: audit bundled/sample assets for licensing and provenance, including suspicious historical packs such as ancient-runes-style content, and fail Ship closed on non-redistributable or unknown assets.

## Refinement 2026-07-17T10:59:25.412265Z

Verification oracle: fresh-profile Electron authoring of license-clean assets, audio and shell; complete Single and two-client multiplayer; copied local artifact boot; real disposable Alchemy deployment to a user-owned Cloudflare target with healthy responses and evidenced cleanup.

## Refinement 2026-07-18T20:00:55.304613Z

User decision 2026-07-18: migrate Tileborne's Cloudflare adapter from Alchemy 0.93.7 to Alchemy v2 as a hard cut; do not keep the legacy inline runner as a fallback.

## Refinement 2026-07-18T20:00:55.50354Z

Evidence: Tileborne pins alchemy 0.93.7 and its first-create behavior-Worker settings request received a non-JSON 404 that became 'The API returned an invalid response' before legacy status handling. This is an adapter/version defect, not an accepted sandbox limitation.

## Refinement 2026-07-18T20:00:55.700194Z

Reference implementation: /Users/kregenrek/projects/planr/apps/docs uses alchemy 2.0.0-beta.63 with an Effect stack, Cloudflare.providers(), Cloudflare.state(), provider-profile OAuth, and explicit adoption; use this ownership pattern while adapting it to Tileborne's two Workers and Durable Object.

## Refinement 2026-07-18T20:00:55.902624Z

Goal oracle refinement: begin with absent disposable game-host and behavior Worker names; deploy the same provider-neutral Ship output through Alchemy v2; verify health, game/room, two-client and authoritative behavior responses; destroy; then prove both Workers are absent with redacted evidence.
