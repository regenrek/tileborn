# Product Specification

## Problem

Tileborne can author and ship a functional Battle Royale game, but a creator
still lacks several essential product layers: enforceable distribution rights,
runtime sound, a polished game-facing menu shell, reusable multiplayer outside
BR, and a supported self-deployment path that is not hard-wired to one vendor CLI.

## Users

- A non-programmer creator building a complete local or self-hosted game.
- A TypeScript plugin author adding a game mode or multiplayer integration.
- A technical operator deploying an exported game to their own cloud account.
- A maintainer auditing bundled/sample content and release readiness.

## Requirements

1. Every shipped asset has provenance, SPDX-compatible license data, redistribution classification, and use-site diagnostics.
2. Disallowed or unknown-license assets block Ship while editor-only/private assets remain explicitly classified.
3. Audio MVP supports import, preview, music/SFX classification, typed event binding, volume/mute basics, deterministic command emission, runtime playback, persistence, packaging, and missing-asset diagnostics.
4. A schema-driven Game Shell supports title, main menu, loading, pause, settings, and results; projects control free fonts, backgrounds, labels, layout tokens, and actions without source edits.
5. Keyboard, mouse, and gamepad navigation, focus, reduced-motion behavior, and readable contrast are first-class.
6. Shell navigation uses typed declarative actions. Behaviors consume/emit supported shell events through the existing SDK/runtime but cannot bypass readiness or own navigation state.
7. Neutral multiplayer contracts cover host/join, private room codes, lobby readiness, participant lifecycle, reconnect, authoritative start/stop, results, errors, and metrics. BR supplies match rules; a second mode proves reuse.
8. Ship Game produces one provider-neutral deployment manifest. Local execution remains first-class; Alchemy implements the first external adapter with Cloudflare proof and no direct Wrangler ownership outside the adapter.
9. Credentials remain process-local/provider-native, are redacted from logs, and never enter project artifacts.
10. Documentation lets a knowledgeable user build locally or deploy to their own Cloudflare account.

## Success Criteria

- The Goal Oracle passes with replayable receipts and no manual file edits.
- A license regression fails closed before export and links to the offending asset.
- Music and at least three event-driven SFX are audible in the shipped reference game.
- The game is navigable from title screen through lobby/match/results and back using keyboard and gamepad.
- Battle Royale and Example Arena (or another neutral fixture) use the same multiplayer lifecycle contract.
- Local copied artifact and real disposable Alchemy/Cloudflare deployment return healthy game responses from identical authored inputs.
- No direct renderer-to-provider, core-to-BR, or project-to-secret ownership violations pass boundary tests.
