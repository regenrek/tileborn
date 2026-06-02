import { Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  MapObject,
  ObjectLayer,
  makeLayerId,
  makeMapId,
  makeObjectId,
  makeTileborneMap,
} from "@tileborne/core";

import { DEFAULT_MAX_PLAYERS, LOOT_CRATE_KIND, SHRINK_ZONE_ANCHOR_KIND, SPAWN_POINT_KIND } from "../../constants.js";
import {
  applyBattleRoyaleAuthoringSettings,
  battleRoyaleObjectCounts,
  readBattleRoyaleAuthoringSettings,
} from "../map-settings.js";

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix}`;
const objectLayerId = makeLayerId(uuid("446655440001"));

describe("battle royale authoring", () => {
  it("counts authored battle royale objects", () => {
    const map = makeTileborneMap({
      id: makeMapId(uuid("446655440002")),
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      layers: [
        new ObjectLayer({
          id: objectLayerId,
          name: "objects",
          visible: true,
          opacity: 1,
          objectIds: [
            makeObjectId(uuid("446655440003")),
            makeObjectId(uuid("446655440004")),
            makeObjectId(uuid("446655440005")),
          ],
        }),
      ],
      objects: [
        object(SPAWN_POINT_KIND, "446655440003"),
        object(SHRINK_ZONE_ANCHOR_KIND, "446655440004"),
        object(LOOT_CRATE_KIND, "446655440005"),
      ],
    });

    expect(battleRoyaleObjectCounts(map)).toEqual({
      spawnPoints: 1,
      shrinkAnchors: 1,
      lootCrates: 1,
    });
  });

  it("persists settings into the map properties consumed by playtest export", () => {
    const map = makeTileborneMap({
      id: makeMapId(uuid("446655440006")),
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      properties: {},
    });

    expect(readBattleRoyaleAuthoringSettings(map).maxPlayers).toBe(DEFAULT_MAX_PLAYERS);

    const next = applyBattleRoyaleAuthoringSettings(map, {
      maxPlayers: 12,
      waitSec: 15,
      shrinkSec: 20,
      holdSec: 10,
      shrinkPhases: 4,
      damagePerSecOutside: 7,
    });

    expect(next.properties).toMatchObject({
      maxPlayers: 12,
      battleRoyale: {
        zone: {
          damagePerSecOutside: 7,
          schedule: {
            waitSec: 15,
            shrinkSec: 20,
            holdSec: 10,
            shrinkPhases: 4,
          },
        },
      },
    });
  });
});

const object = (kind: MapObject["kind"], suffix: string): MapObject =>
  new MapObject({
    id: makeObjectId(uuid(suffix)),
    kind,
    x: 0,
    y: 0,
    width: Option.none(),
    height: Option.none(),
    layerId: objectLayerId,
    properties: {},
  });
