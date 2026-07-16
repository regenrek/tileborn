---
title: "Battle Royale Creator Guide"
description: "Create, author, playtest, recover, and ship the Battle Royale vertical."
sidebar:
  label: "Battle Royale Creator Guide"
---
# Battle Royale Creator Guide

This is the supported creator path for the Battle Royale 1.0 vertical.

## Create and author

1. Choose **New Game**, select **Battle Royale**, name the project, and create it. The starter creates a playable map and stable mode defaults; no CLI authoring is required.
2. Import or select real assets in the Asset Library. Add only the assets you are actively using to the Working Palette; the palette and sprite picker remain windowed for large libraries.
3. Use **Game Content** to create items, weapons, loot, and object types. Project-owned definitions are editable; plugin templates are immutable and can be duplicated into the project.
4. Use the Sprite Studio and Player Model editor to slice sheets, define clips, choose anchors/hitboxes, and connect the resulting visual model to gameplay content.
5. Author spawn points, at least one shrink-zone anchor, loot sources, player models, and Battle Royale rules on the map.
6. Open **Behaviors** to add a typed Battle Royale template or build a visual WHEN/IF/DO sheet. Use typed reference pickers and fix every behavior error in **Problems** before playtest.

## Readiness and playtest

Open **Problems** before playtest or Ship. Errors block those actions; warnings stay visible but do not block. Selecting a problem navigates to its owning map object, content definition, asset, or setting. Fix the issue and rerun readiness rather than bypassing the gate.

- **Single** starts the local authored map with the selected rules, content, and visuals.
- **Local multiplayer** creates a private join-code lobby. A second client joins with the code; both players ready before the match starts. Disconnects reserve a time-bounded reconnect seat, and a terminal room exposes durable results.

The **Runtime** inspector shows the current event, source/block, state, branch,
actions, diagnostics, and a bounded per-instance trace. Pause, step, and continue
operate on the authoritative runtime. Successful edits hot-reload; a compile
failure preserves the last-known-good behavior and links back to the owning
source or visual block. **Convert to TypeScript** is an explicit, one-way eject
path and cannot be converted back to visual blocks.

## Save, recover, and Ship

Dirty documents offer **Save**, **Discard**, and **Cancel**. A failed save blocks close and remains dirty. Project map, manifest, and integrity lock publish as one recoverable revision; after a crash, reopen the recovery snapshot and save or explicitly discard it.

Use **Ship** from Overview, the top bar, or the command palette. All entry points use the same readiness and build flow. The local target produces a self-contained artifact with its worker, selected startup map package, project content, plugin runtime, integrity hashes, and run instructions. Verify the copied artifact outside the workspace before distributing it.

## Keyboard and accessibility

Labeled form controls, semantic buttons, problems, and status text are exposed to assistive technology. Dialog focus stays within the active workflow. Sprite clip selection uses a radiogroup with roving focus: arrow keys move, Enter or Space selects. Destructive and dirty-close actions always require an explicit choice.

## Known limits for the 1.0 candidate

- Cloudflare deployment still requires the optional native Wrangler/Forge environment; local Ship is the release oracle.
- The two-client Electron creator flow is proven through explicit ready, active simulation, Victory/Defeat, durable terminal results, and participant exit without stopping the owner-hosted room. The Forge production package is also proven independently: root build 23/23, a lockfile-derived 29-package runtime closure, and a 2/2 copied out-of-workspace `.app` smoke reaching a visible packaged renderer without repository module resolution.
- Missing/disabled mode plugins, moved or corrupt assets, denied/disk-full saves, and failed builds are surfaced as actionable errors; they are not auto-repaired or silently ignored.
