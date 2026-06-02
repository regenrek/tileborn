import { Schema } from "effect";

import { MapId, PackId, PluginId } from "../ids.js";

/**
 * Brand-injected configuration for the shipped game client. The shape mirrors
 * the product `branding/tokens.json` consumed at build time: products overlay
 * branding/chrome (title/logo/palette/copy/legal), declare which plugin +
 * room-rules drive the server, and may add product-only menu tabs via
 * {@link BrandMenuExtension}. This schema is brand-NEUTRAL: it hardcodes no
 * product names — only generic strings the product fills in.
 *
 * Owner: `@tileborne/core` (ADR-0022). Consumed by `@tileborne/game-client`
 * (theming + shell) and the game build (static-asset overlay).
 */
const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

/** HUD/menu palette. Values are CSS color strings mapped to CSS variables. */
export class BrandPalette extends Schema.Class<BrandPalette>("BrandPalette")({
  background: NonEmptyString,
  surface: NonEmptyString,
  accent: NonEmptyString,
  accentHostile: NonEmptyString,
  accentFriendly: NonEmptyString,
  textPrimary: NonEmptyString,
  textMuted: NonEmptyString,
}) {}

export class BrandLogo extends Schema.Class<BrandLogo>("BrandLogo")({
  src: NonEmptyString,
  alt: NonEmptyString,
}) {}

export class BrandLobbyCopy extends Schema.Class<BrandLobbyCopy>("BrandLobbyCopy")({
  tagline: Schema.String,
  cta: Schema.String,
}) {}

export class BrandLegal extends Schema.Class<BrandLegal>("BrandLegal")({
  tos: Schema.String,
  privacy: Schema.String,
}) {}

export class BrandRoomRules extends Schema.Class<BrandRoomRules>("BrandRoomRules")({
  maxPlayers: Schema.Int,
  timeLimitSeconds: Schema.Int,
  friendlyFire: Schema.Boolean,
}) {}

export class BrandReplayConfig extends Schema.Class<BrandReplayConfig>("BrandReplayConfig")({
  enabled: Schema.Boolean,
  prefix: Schema.optional(Schema.String),
}) {}

/** Server wiring: which plugin + room rules a brand runs. */
export class BrandServers extends Schema.Class<BrandServers>("BrandServers")({
  plugin: PluginId,
  roomRules: Schema.optional(BrandRoomRules),
  lootTable: Schema.optional(Schema.String),
  replays: Schema.optional(BrandReplayConfig),
}) {}

/**
 * A product-only menu tab/section the brand mounts into a named menu slot
 * (e.g. Account / Leaderboard / Profile). `slot` is the menu-slot id string
 * (see `@tileborne/plugin-api` `RuntimeMenuSlot`); kept a plain string here so
 * `@tileborne/core` stays a leaf with no dependency on the contracts package.
 * The component for each extension is registered by the product at build time.
 */
export class BrandMenuExtension extends Schema.Class<BrandMenuExtension>("BrandMenuExtension")({
  id: NonEmptyString,
  slot: NonEmptyString,
  label: NonEmptyString,
  order: Schema.optional(Schema.Number),
}) {}

export class BrandConfig extends Schema.Class<BrandConfig>("BrandConfig")({
  schemaVersion: Schema.optional(Schema.Int),
  title: NonEmptyString,
  logo: Schema.optional(BrandLogo),
  palette: BrandPalette,
  lobbyCopy: BrandLobbyCopy,
  legal: Schema.optional(BrandLegal),
  servers: Schema.optional(BrandServers),
  assetPackId: Schema.optional(PackId),
  mapId: Schema.optional(MapId),
  menuExtensions: Schema.optional(Schema.Array(BrandMenuExtension)),
}) {}

export type BrandConfigInput = typeof BrandConfig.Encoded;

/** Decode a (product-supplied) brand config from unknown JSON. */
export const decodeBrandConfig = Schema.decodeUnknownSync(BrandConfig);
