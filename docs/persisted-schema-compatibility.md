# Persisted schema compatibility

Status: release-candidate audit, 2026-07-16.

The machine-readable source of truth is
`packages/core/src/versioning/persisted-schema-registry.ts`. It owns current
version numbers and the compatibility claim. The codec and migration functions
remain with the domain named by each registry entry; renderer code must not
migrate project files.

The audited inventory currently contains **44 formats: 38 versioned and 6
explicitly unversioned gaps**. A repository-level test keeps this independently
enumerated surface list aligned and validates every owner file/symbol pointer.

## Policy

- **Authoring source** is never reset or rebuilt when it is unknown or corrupt.
  The loader must migrate an explicitly supported older version, otherwise
  refuse without modifying the source. A future upgrade must back up and verify
  restore before replacing source bytes.
- **Recovery state** may restore a coherent source revision or refuse/quarantine
  the recovery record. It must not overwrite coherent source with unverified
  snapshots.
- **Replaceable derived data** is invalidated and rebuilt from authoring source;
  it is not migrated in place.
- **Shipped artifacts** are exact-version inputs and are rebuilt from authoring
  source. Runtime readers never guess how to downgrade a package.
- **User preferences** may reset when corrupt or unsupported. They cannot block
  project open, playtest, or Ship Game.
- **Server state** migrates only the explicitly listed sequential versions and
  refuses future/corrupt state.

`readable` below is an exact set, not a minimum-version promise. “shape” means
an idempotent compatibility transform inside the current version and is a
known debt that requires a committed legacy fixture in the next durability
slice.

## Compatibility matrix

| Format                                         |       Current | Readable                      | Older                        | Future / corrupt           | Durability and owner evidence                                              |
| ---------------------------------------------- | ------------: | ----------------------------- | ---------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| Project manifest                               |             1 | 1                             | refuse (empty chain)         | refuse / refuse            | source; core `ProjectManifest`, services-app `projectMigrationChain`       |
| Tileborne map                                  |             1 | 1 + legacy shape              | current-only shape transform | refuse / refuse            | source; core `decodePersistedTileborneMapJson`                             |
| Project content                                |             1 | 1 + legacy bare catalog shape | current-only shape transform | refuse / refuse            | source; plugin-api `decodeProjectContentDocument`                          |
| Game-object catalog + entries                  |             1 | 1                             | refuse                       | refuse / refuse            | source; core `GameObjectCatalog`/`GameObjectType`                          |
| Weapon catalog                                 |             1 | 1                             | refuse                       | refuse / refuse            | source; plugin-api `WeaponCatalog`                                         |
| Visual behavior definition                     |             1 | 1                             | refuse                       | refuse / refuse            | source; core `migrateBehaviorDefinitionJson`                               |
| Behavior manifest / authoring registry catalog |             1 | 1                             | refuse                       | refuse / refuse            | source; core behavior codecs                                               |
| Project behavior registry                      |             1 | 1                             | refuse                       | refuse / refuse            | source; services-app behavior service                                      |
| Project import records                         |             1 | 1                             | refuse                       | refuse / refuse            | source; services-app project service                                       |
| Tileborne home config                          |             1 | 1                             | refuse                       | refuse / refuse            | preference; services-foundation `TileborneConfig`                          |
| Brand config (`branding/tokens.json`)          |             1 | 1 + missing-version shape     | refuse                       | refuse / refuse            | source; core `BrandConfig`, CLI template                                   |
| Thin-game project config                       |   unversioned | none declared                 | n/a                          | refuse / refuse            | **gap**; CLI-generated `tileborne.config.json`                             |
| Working-palette store                          |             1 | 1                             | refuse                       | refuse / refuse            | source; core codec + services-app asset-library service                    |
| Generic asset-pack manifest                    |   unversioned | none declared                 | n/a                          | refuse / refuse            | **gap**; asset-pipeline generic codec                                      |
| Tileset manifest/pack                          |             1 | 1                             | refuse                       | refuse / refuse            | source; sdk-tileset parser/writer                                          |
| Plugin manifest                                |             1 | 1                             | refuse (empty/unused chain)  | refuse / refuse            | source; plugin-api codec + services-plugin chain                           |
| Project revision journal / owner               |         1 / 1 | 1 / 1                         | refuse                       | refuse / restore-or-refuse | recovery; services-app revision transaction                                |
| Behavior transaction journal                   |             2 | 2                             | refuse                       | refuse / refuse-quarantine | recovery; services-app behavior service                                    |
| Document recovery record                       |             1 | 1                             | reset                        | reset / reset              | recovery; desktop document lifecycle                                       |
| Project integrity lock                         |             1 | 1                             | rebuild                      | rebuild / rebuild          | derived; services-app project service                                      |
| Project registry                               |             1 | 1                             | rebuild                      | rebuild / rebuild          | derived; services-app registry                                             |
| Project asset index                            |             1 | 1                             | rebuild                      | rebuild / rebuild          | derived; services-app asset service                                        |
| Asset-pack integrity lock                      |             1 | 1                             | rebuild                      | rebuild / rebuild          | derived; services-app asset service                                        |
| Plugin install lock                            |             1 | 1                             | rebuild                      | rebuild / rebuild          | derived; **reader identity/version validation gap**                        |
| Plugin archive metadata sidecar                |             1 | 1                             | refuse                       | refuse / refuse            | shipped; services-plugin writer; **runtime reader gap**                    |
| Asset-library / editor-tileset indexes         |         1 / 1 | 1 / 1                         | rebuild                      | rebuild / rebuild          | derived; services-app + sdk-tileset                                        |
| Thumbnail cache / tile-palette metadata        |         1 / 1 | 1 / 1                         | rebuild                      | rebuild / rebuild          | derived; desktop main/renderer                                             |
| Runtime map package                            |             4 | 4                             | refuse/rebuild artifact      | refuse / refuse            | shipped; core codec + runtime loader                                       |
| Runtime behavior / project-content sections    |         1 / 1 | 1 / 1                         | refuse/rebuild artifact      | refuse / refuse            | shipped; core/plugin-api codecs                                            |
| Bundled game manifest                          |             1 | 1                             | refuse/rebuild artifact      | refuse / refuse            | shipped; game-host builder; **runtime decode gap**                         |
| Build/export metadata                          |   unversioned | none declared                 | n/a                          | refuse / refuse            | **gap**; services-build integrity wrapper                                  |
| Room Durable Object state                      |             3 | 1, 2, 3                       | migrate 1→2→3                | refuse / refuse            | server; game-host `migrateRoomStorage`; **current payload validation gap** |
| Input / HUD user overlays                      |   1 / 1 (key) | 1 / 1                         | reset                        | reset / reset              | preference; game-client owns input persistence; desktop delegates          |
| Editor UI store                                | 0 (container) | 0                             | reset                        | reset / reset              | preference; explicit Zustand persist version                               |
| Lobby model selection                          |   unversioned | none declared                 | n/a                          | reset / reset              | **gap**; raw localStorage string                                           |
| Battle Royale loadout selection                |   unversioned | none declared                 | n/a                          | reset / reset              | **gap**; plugin raw localStorage string                                    |
| Lobby reconnect credential                     |       1 (key) | 1                             | reset                        | reset / reset              | preference; game-client localStorage (security-sensitive)                  |
| Persistent job record                          |   unversioned | none declared                 | n/a                          | reset / reset              | **gap**; services-foundation operational recovery cache                    |

## Audit verdict and next-slice handoff

The registry closes version-number drift and makes the present compatibility
claim testable. It does **not** claim migration support that does not exist.
The following items are intentionally left for the next Planr durability item:

1. committed legacy/current/future/corrupt fixtures;
2. real ordered project/map/content migrations with backup-first orchestration;
3. restore verification and unsupported-version source-preservation receipts;
4. runtime validation for room state and the bundled game manifest;
5. explicit envelopes for generic asset packs, thin-game config, job records,
   model/loadout selections, and build/export metadata;
6. plugin-lock identity/version enforcement and activation of the plugin
   manifest migration chain.

Journal phase fault injection remains a separate subsequent item.
