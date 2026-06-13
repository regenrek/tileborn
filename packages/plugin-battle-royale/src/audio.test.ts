import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  defaultRuntimeAudioSettings,
  resolveAudioCuePlayback,
} from "../../runtime/src/audio/mixer.js";
import {
  BR_AUDIO_BUS_CONTRIBUTION_ID,
  BR_AUDIO_CUES,
  battleRoyaleAudioCueDefinitionForEvent,
  battleRoyaleAudioCueForEvent,
  battleRoyaleSfxBus,
  buildBattleRoyaleAudioBusData,
} from "./audio.js";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const readManifestAudioBusData = (): unknown => {
  const manifestPath = path.join(packageRoot, "../tileborne-plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    contributes?: {
      runtime?: { audioBuses?: readonly { readonly id: string; readonly data: unknown }[] };
    };
  };
  const contribution = manifest.contributes?.runtime?.audioBuses?.find(
    (entry) => entry.id === BR_AUDIO_BUS_CONTRIBUTION_ID,
  );
  if (!contribution) {
    throw new Error("battle-royale manifest is missing the audio-bus contribution");
  }
  return contribution.data;
};

describe("battle royale audio contribution", () => {
  it("keeps the manifest audioBuses data in sync with the code-built data", () => {
    expect(readManifestAudioBusData()).toEqual(buildBattleRoyaleAudioBusData());
  });

  it("maps gameplay events to stable cue ids", () => {
    expect(battleRoyaleAudioCueForEvent({ type: "weapon.fire" })).toBe(BR_AUDIO_CUES.WeaponFire);
    expect(battleRoyaleAudioCueForEvent({ type: "weapon.reload" })).toBe(BR_AUDIO_CUES.WeaponReload);
    expect(battleRoyaleAudioCueForEvent({ type: "player.hit" })).toBe(BR_AUDIO_CUES.PlayerHit);
    expect(battleRoyaleAudioCueForEvent({ type: "player.eliminated" })).toBe(
      BR_AUDIO_CUES.PlayerEliminated,
    );
    expect(battleRoyaleAudioCueForEvent({ type: "pickup.collect" })).toBe(
      BR_AUDIO_CUES.PickupCollect,
    );
    expect(battleRoyaleAudioCueForEvent({ type: "zone.warning" })).toBe(BR_AUDIO_CUES.ZoneWarning);
  });

  it("routes BR events through the runtime mixer mute and volume policy", () => {
    const playback = resolveAudioCuePlayback(
      battleRoyaleAudioCueDefinitionForEvent({ type: "weapon.fire" }),
      battleRoyaleSfxBus,
      {
        ...defaultRuntimeAudioSettings(),
        masterVolume: 0.5,
        busVolumes: { "battle-royale.sfx": 0.5 },
      },
      "focused",
    );

    expect(playback).toMatchObject({
      cueId: BR_AUDIO_CUES.WeaponFire,
      busId: "battle-royale.sfx",
      audible: true,
    });
    expect(playback.gain).toBeCloseTo(0.18);

    expect(
      resolveAudioCuePlayback(
        battleRoyaleAudioCueDefinitionForEvent({ type: "weapon.fire" }),
        battleRoyaleSfxBus,
        { ...defaultRuntimeAudioSettings(), muted: true },
        "focused",
      ),
    ).toMatchObject({ gain: 0, audible: false, mutedReason: "master-muted" });
  });
});
