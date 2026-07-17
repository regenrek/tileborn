import { Schema } from 'effect';

import { PluginId } from '../ids.js';

/**
 * Neutral, OPEN game-mode identifier (ADR-0023 section B).
 *
 * A `GameModeId` is a branded string that identifies which discovered
 * plugin/mode owns playtest, inspector, and settings for a project (and
 * optionally a map). It is intentionally open — a mode id is conventionally a
 * `PluginId` acting as a mode — so a new genre plugin becomes a selectable
 * mode with ZERO engine edits. The engine never enumerates a closed mode/genre
 * enum (ADR-0023 risk 2 + forbidden-token boundary).
 */
export const GameModeId = Schema.String.pipe(Schema.brand('GameModeId'));
export type GameModeId = typeof GameModeId.Type;

/**
 * Derive a {@link GameModeId} from a {@link PluginId}. The mode id IS the
 * plugin id (a plugin that declares a runtime system + settings panel is a
 * selectable mode); this helper keeps the brand cast in one place so callers
 * never hand-brand the literal.
 */
export const gameModeIdFromPluginId = (pluginId: PluginId): GameModeId =>
  pluginId as string as GameModeId;

/**
 * The active game mode selected for a project (and optionally a map).
 *
 * Durable schema (ADR-0023 section B). Per-mode settings VALUES persist under
 * the neutral namespace `project.settings.<pluginId>` / `map.properties.<pluginId>`
 * — owned by the parallel settings slice (`t-gae-settings`), not here. This
 * type only records WHICH discovered mode is active; the discovery + resolution
 * of the mode's contributions lives in `@tileborne/plugin-api`.
 */
export class ActiveGameMode extends Schema.Class<ActiveGameMode>('ActiveGameMode')({
  modeId: GameModeId,
}) {}
