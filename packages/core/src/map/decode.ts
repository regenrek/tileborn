import { Schema } from "effect";

import { TileborneMap } from "./index.js";
import { migrateLegacyMapJson } from "./migrate.js";

/**
 * THE canonical persisted-map decode boundary (ADR-0019). Every raw decode of a
 * persisted Tileborne map — CLI map reads, headless playtest artifact decode,
 * asset cleanup, and the map services — MUST route through this helper so the
 * legacy-`kind` migration ({@link migrateLegacyMapJson}) can never be skipped
 * at a load boundary. Optional map-object/placement fields use an
 * optional-KEY encoding (`Schema.OptionFromOptionalKey`), so persisted JSON
 * that omits them decodes directly — no key backfill is needed anywhere.
 *
 * Throws on an unmappable legacy kind (`LegacyMapObjectKindError`) or a map that
 * is structurally invalid (`ParseError`) — we fail loudly rather than load
 * corrupted data.
 */
export const decodePersistedTileborneMapJson = (parsed: unknown): TileborneMap =>
  Schema.decodeUnknownSync(TileborneMap)(migrateLegacyMapJson(parsed));
