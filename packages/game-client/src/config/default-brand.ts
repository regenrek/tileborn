import { BrandConfig, BrandLobbyCopy, BrandPalette } from "@tileborne/core";

/**
 * Neutral default brand for the unbranded game-client template ("Tileborne
 * Game"). Products override this by supplying their own {@link BrandConfig}
 * (e.g. from `branding/tokens.json`). Contains no product names or assets.
 */
export const defaultBrandConfig: BrandConfig = new BrandConfig({
  schemaVersion: 1,
  title: "Tileborne Game",
  logo: undefined,
  palette: new BrandPalette({
    background: "#0b1220",
    surface: "#141c2f",
    accent: "#6ee7a8",
    accentHostile: "#f87171",
    accentFriendly: "#60a5fa",
    textPrimary: "#f8fafc",
    textMuted: "#94a3b8",
  }),
  lobbyCopy: new BrandLobbyCopy({
    tagline: "A neutral Tileborne game client.",
    cta: "Play",
  }),
  legal: undefined,
  servers: undefined,
  assetPackId: undefined,
  mapId: undefined,
  menuExtensions: undefined,
});
