# ADR-0026: First-class visual and player model editor workbench

- Status: Proposed
- Date: 2026-06-09
- Deciders: Tileborne core team
- Tags: editor-ui, workbench, visual-role, player-model, plugin-boundary, renderer, core-schema, diagnostics, live-proof, research

## Context

Tileborne now has the pieces needed to render authored game visuals:

- `packages/core` owns `VisualAssetRoleRef`, `RenderProfile`, `AttachmentAnchor`, `WeaponVisualBinding`, and `PlayerModelRef`.
- `apps/desktop` can assign an active asset to a Battle Royale visual role from the inspector.
- `packages/plugin-battle-royale` consumes resolved visual role render data for equipped weapons, projectiles, pickups, muzzle flash, impact VFX, shields, shadows, hazards, and player models.

The remaining gap is authoring quality. Weapon direction, hand attachment, muzzle flash origin, player hitbox, player muzzle, model scale, and clip binding are still too hard to inspect and tune. The right inspector is useful for fast assignment, but it is not the right surface for precise visual geometry editing.

The product target is a first-class editor experience similar to RPG Maker, Godot, or other 2D game makers: the author selects an asset or model, opens a dedicated editor tab, drags anchor handles on a sprite preview, edits exact numeric values, and sees a live gameplay preview before playtest.

This ADR is design-only. It defines ownership, editor surfaces, plugin policy, required contracts, and implementation slices for PlanDB parent `t-vme-workbench`.

## Decision

Tileborne adopts a **first-class Visual and Player Model Editor Workbench**. Detailed visual tuning moves out of the right inspector and into reusable main-window editor panels opened like Map and Asset Library tabs.

The workbench has two primary editors:

1. **Visual Role Editor** for `VisualAssetRoleRef`
   - Equipped weapon
   - Projectile
   - Pickup
   - Muzzle flash
   - Impact VFX
   - Shield
   - Shadow
   - Hazard

2. **Player Model Editor** for `PlayerModelRef`
   - Clip bindings
   - Default clip
   - Anchor/pivot
   - Hitbox
   - Muzzle point
   - Render scale/world size
   - Animation preview

Both editors reuse a shared **Sprite Geometry Canvas**:

- checker/grid background
- zoom and pan
- frame/clip preview
- draggable normalized handles
- numeric fields bound to the same model
- reset-to-default controls
- hitbox/footprint overlays
- live preview modes

### UI model

The right inspector remains the lightweight workflow surface:

- assign the active sprite to a visual role
- show the current assignment
- remove/reset an override
- open the full editor panel

Detailed editing happens in the workbench:

```text
left rail        center canvas                  right properties
---------        ----------------------------   -------------------------
role/model list  sprite preview + handles       numeric geometry fields
asset selector   live gameplay preview          validation + defaults
clip selector    zoom/pan/grid controls         save/reset/remove actions
```

The Visual Role Editor adds a weapon preview mode that renders a selected player model with the equipped weapon, muzzle flash, and projectile origin at aim angles 0, 90, 180, and 270 degrees. This is the authoritative authoring surface for fixing weapon orientation and muzzle alignment.

The Player Model Editor adds a clip preview mode for idle, walk, run, shoot, reload, hit, death, dash, and pickup. It also previews hitbox and muzzle point against the selected frame.

## Ownership

| Concern                                                            | Runtime owner                        | First-fix owner                                           | Canonical long-term owner                                                                    |
| ------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Durable visual role and player model data                          | project settings and plugin defaults | current `VisualAssetRoleRef` / `PlayerModelRef` usage     | `packages/core` schemas, validation, defaults, normalization                                 |
| Main-window editor panels and tab/session behavior                 | renderer workbench                   | existing inspector-only role assignment                   | `apps/desktop/src/renderer` workbench/open-panel shell                                       |
| Sprite geometry canvas and numeric editor controls                 | renderer UI                          | existing Sprite Studio and visual-role assignment helpers | `apps/desktop/src/renderer` reusable editor components                                       |
| Role labels, required anchors, default profiles, preview scenarios | plugin policy data                   | Battle Royale-specific role defaults                      | plugin contributions through `packages/plugin-api`; BR supplies data, not generic UI         |
| Runtime visual consumption                                         | projectors/renderers                 | BR projector fallback guesses                             | plugin projectors consume resolved metadata; generic render types stay in `packages/runtime` |
| Visual/model diagnostics                                           | editor validation and playtest gate  | ad hoc missing/default role behavior                      | shared diagnostics contract plus plugin-authored severity/policy                             |

### Competing owners that are wrong

- The right inspector must not become the dense geometry editor.
- `packages/plugin-battle-royale` must not own the generic Visual Role Editor or Player Model Editor UI.
- Runtime/projector code must not infer hand, muzzle, or rotation when first-class metadata exists.
- `apps/desktop` must not import plugin executable code or plugin-private implementation details to render the editor.
- A separate weapon-metadata format must not duplicate `VisualAssetRoleRef`.

### Cleanup direction

The implementation graph should hard-cut toward one authored metadata path:

- Keep the inspector as assignment/status/open-editor UI and remove any pressure to grow dense geometry controls there.
- Move reusable visual editing controls into the shared workbench/canvas layer instead of copying small anchor forms into BR-specific components.
- Replace BR projector fallback guesses for hand, muzzle, scale, and rotation whenever a resolved visual role provides metadata.
- Keep fallback geometry only as policy/default data that is visible to the editor and can be overridden by the project.
- Remove or prevent generic desktop imports of BR-private role/model helpers once plugin policy contributions exist.
- Avoid dual persistence between asset source properties and project role/model overrides; imported metadata may seed defaults, but saved project overrides are the authoring source of truth.

## Core contract direction

`packages/core` remains the canonical durable data owner. The next implementation slice must audit and harden these existing concepts:

- `RenderProfile.scale`
- `RenderProfile.pivot`
- `RenderProfile.footprint`
- `AttachmentAnchor.point`
- `AttachmentAnchor.rotationDeg`
- `AttachmentAnchor.zOffset`
- `VisualAssetRoleRef.anchors`
- `PlayerModelRef.anchor`
- `PlayerModelRef.hitbox`
- `PlayerModelRef.muzzle`

If projectile or weapon sprite orientation needs durable metadata, it should extend the existing visual-role family without adding a BR-only field. The preferred shape is a role-level or binding-level rotation offset consumed by projectors, with schema validation in core and plugin defaults supplied as policy.

The core layer must not contain Battle Royale, Petwars, ERW, Maltipoo, or private product literals.

## Plugin contribution direction

Plugins contribute policies and defaults, not generic editor implementations.

A future plugin policy contribution should describe:

- role kind
- label and icon hint
- whether the role is required for playtest
- required anchors, such as `hand` and `muzzle`
- default render profile
- default anchors
- validation severities
- preview scenario hints, such as "weapon mounted on selected player model"
- optional asset filter hints

Battle Royale then supplies:

- equipped weapon requires `hand` and `muzzle`
- projectile may need rotation offset
- muzzle flash attaches to equipped weapon muzzle
- impact VFX and shield preview around the player
- player model requires the BR clip set and valid hitbox/muzzle

The desktop shell renders the generic editor from those policies.

## Workbench integration direction

`apps/desktop` owns open-panel behavior. The editor should use the existing workbench tab pattern used by Map and Asset Library surfaces:

- stable tab id per visual role or player model
- command/open API usable from inspector, asset library, command palette, and future context menus
- session restore where the workbench already supports it
- close/dirty-state behavior consistent with other editor surfaces
- no dense editing controls in the inspector

The renderer may use project settings and asset-pack queries, but must not run plugin executable code. Any plugin-specific editor policy must be declarative or loaded through existing safe manifest/contribution paths.

## Runtime consumption direction

Projectors consume resolved metadata:

- equipped weapon anchor comes from the selected role's `hand` attachment anchor
- muzzle flash and projectile origin come from the selected role's `muzzle` attachment anchor
- render scale/pivot come from `RenderProfile`
- role/binding rotation offset is used when the source sprite is not authored facing right
- missing metadata falls back only to policy defaults, not hardcoded BR guesses

The Battle Royale projector can keep responsibility for interpreting BR snapshot data, but it must use resolved role metadata for visual placement and orientation.

## Diagnostics

The workbench must surface visual/model setup problems before playtest when possible:

- required visual role missing
- visual role still points at a bundled placeholder when a project override is required
- equipped weapon missing `hand` or `muzzle`
- projectile has no orientation metadata when the sprite source needs it
- player model missing required clips
- invalid player anchor/hitbox/muzzle
- invalid normalized points, scale, z-offset, or rotation values
- stale asset reference or missing clip

Warnings should not block authoring unnecessarily. Errors should block playtest only when the runtime cannot produce a coherent render or input result.

## Non-goals

- Replacing Sprite Studio asset import or spritesheet slicing.
- Defining weapon balance, damage, ammo, cooldown, or inventory rules.
- Moving runtime simulation into the editor.
- Building BR-only editor panels.
- Solving all animation retargeting or skeletal animation concerns.
- Creating a private Petwars-specific editor path.

## Implementation slices

These are already represented in PlanDB under parent `t-vme-workbench`.

1. `t-vme-arch`: this architecture and ownership ADR.
2. `t-vme-core-transform`: harden core visual transform contracts and validation.
3. `t-vme-open-panel`: add workbench/open-panel shell entries for visual-role-editor and player-model-editor.
4. `t-vme-canvas`: build the reusable sprite geometry canvas.
5. `t-vme-visual-role-editor`: implement Visual Role Editor persistence and UI.
6. `t-vme-weapon-preview`: add weapon/muzzle/projectile live preview.
7. `t-vme-render-consume`: make projectors consume edited metadata.
8. `t-vme-player-model-editor`: implement Player Model Editor.
9. `t-vme-plugin-policy`: refactor role/model editor policies into plugin contributions.
10. `t-vme-diagnostics`: add authoring diagnostics and playtest gate.
11. `t-vme-live-proof`: verify in live Electron.
12. `t-vme-final-review`: final clean review gate before closing the parent.

## Boundary tests required

Later implementation slices should add or update boundary tests asserting:

- renderer visual editor code does not import plugin executable code, Electron, Node, or main-process services
- generic visual editor components do not import Battle Royale plugin internals
- core visual contracts contain no product or mode literals
- plugin policy data can add a new role/model preview without editing the generic editor
- BR projector consumes visual metadata instead of relying on hardcoded fallback geometry when metadata exists

## Verification plan

Minimum automated verification for the implementation graph:

- `packages/core` schema and validation round-trips for transform/anchor/model changes
- desktop renderer tests for open-panel routing, editor persistence, dirty-state behavior, canvas handle updates, and diagnostics
- plugin projector tests proving hand/muzzle/rotation metadata changes rendered weapon and muzzle positions
- package typechecks for every touched package

Final live proof:

1. Open Visual Role Editor from inspector.
2. Edit weapon hand anchor, muzzle anchor, and rotation.
3. Start Battle Royale playtest.
4. Confirm weapon direction and muzzle flash position align.
5. Open Player Model Editor.
6. Adjust model geometry and clip configuration.
7. Confirm Battle Royale playtest uses the saved player model.

## Consequences

Positive:

- Visual/gameplay asset setup becomes inspectable and repeatable.
- Weapon/muzzle alignment becomes authored metadata, not runtime guessing.
- Player model authoring gets a proper first-class surface.
- Future game-mode plugins can reuse the same editors with their own policies.
- The right inspector stays focused and fast.

Negative:

- Requires careful workbench/session integration.
- Requires a core contract audit before UI work.
- Requires review discipline to avoid BR-specific code leaking into generic editor components.
- Live proof must account for stale dev-server/plugin-install caches.

## Definition of done for this ADR

- ADR-0026 is added and indexed in `docs/adrs/README.md`.
- Ownership split, UI model, core contract direction, plugin policy direction, diagnostics, implementation slices, and verification plan are recorded.
- PlanDB contexts capture the key decisions.
- No implementation code is required in this slice.
