import { CORE_HUD_WIDGET_KINDS } from "@tileborne/core";
import { decodeHudLayout } from "@tileborne/plugin-api";
import { Result } from "effect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BR_HUD_LAYOUT_CONTRIBUTION_ID,
  BR_HUD_LAYOUT_ID,
  battleRoyaleDefaultHudLayout,
  buildBattleRoyaleHudLayoutData,
} from "./hud-layout.js";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const readManifestHudLayoutData = (): unknown => {
  const manifestPath = path.join(packageRoot, "../tileborne-plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    contributes?: {
      runtime?: { hudLayouts?: readonly { readonly id: string; readonly data: unknown }[] };
    };
  };
  const contribution = manifest.contributes?.runtime?.hudLayouts?.find(
    (entry) => entry.id === BR_HUD_LAYOUT_CONTRIBUTION_ID,
  );
  if (!contribution) {
    throw new Error("battle-royale manifest is missing the hud-layout contribution");
  }
  return contribution.data;
};

describe("battle royale hud-layout contribution", () => {
  it("decodes the manifest hudLayouts slot data against the @tileborne/core HudLayout schema", () => {
    const decoded = decodeHudLayout(BR_HUD_LAYOUT_CONTRIBUTION_ID, readManifestHudLayoutData());
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success.id).toBe(BR_HUD_LAYOUT_ID);
    }
  });

  it("keeps the code-built default layout in sync with the manifest (both decode equal)", () => {
    const fromManifest = decodeHudLayout(BR_HUD_LAYOUT_CONTRIBUTION_ID, readManifestHudLayoutData());
    expect(Result.isSuccess(fromManifest)).toBe(true);
    if (Result.isSuccess(fromManifest)) {
      expect(battleRoyaleDefaultHudLayout()).toEqual(fromManifest.success);
    }
  });

  it("only places engine-baseline widget kinds with unique instance ids", () => {
    const data = buildBattleRoyaleHudLayoutData();
    const kinds = new Set(CORE_HUD_WIDGET_KINDS);
    for (const widget of data.widgets) {
      expect(kinds.has(widget.kind)).toBe(true);
    }
    expect(new Set(data.widgets.map((widget) => widget.id)).size).toBe(data.widgets.length);
  });

  it("reproduces today's BR HUD arrangement (status left, intel right, weapon bottom-center)", () => {
    const layout = battleRoyaleDefaultHudLayout();
    const anchorOf = (id: string): string | undefined =>
      layout.widgets.find((widget) => (widget.id as string) === id)?.anchor;
    expect(anchorOf("local-player")).toBe("top-left");
    expect(anchorOf("minimap")).toBe("top-right");
    expect(anchorOf("weapon-panel")).toBe("bottom-center");
    expect(anchorOf("kill-feed")).toBe("bottom-left");
  });
});
