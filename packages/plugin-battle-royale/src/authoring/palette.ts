import { CrosshairIcon, PackageIcon, RadioTowerIcon } from "lucide-react";

import { LOOT_CRATE_KEY, PLUGIN_ID, SHRINK_ZONE_ANCHOR_KEY, SPAWN_POINT_KEY } from "../constants.js";

/**
 * Battle Royale's authoring object kinds mapped to their editor presentation
 * (label / description / icon). This is the canonical, plugin-owned mapping from
 * BR object kinds to how the editor surfaces them; the editor consumes it purely
 * through the abstract palette-action contribution shape it defines.
 */
export const BATTLE_ROYALE_AUTHORING_OBJECTS = [
  {
    kind: SPAWN_POINT_KEY,
    label: "Spawn point",
    description: "Player start position",
    icon: CrosshairIcon,
  },
  {
    kind: SHRINK_ZONE_ANCHOR_KEY,
    label: "Shrink anchor",
    description: "Safe-zone center",
    icon: RadioTowerIcon,
  },
  {
    kind: LOOT_CRATE_KEY,
    label: "Loot crate",
    description: "Supply source",
    icon: PackageIcon,
  },
] as const;

/**
 * Battle Royale's contribution to the editor's generic palette-action
 * mechanism. Each entry becomes a selectable `plugin-object` marker brush in the
 * Working Palette's "Markers & Tools" group. This is the ONLY place that maps
 * Battle-Royale object kinds to labels/icons; the editor consumes it purely
 * through its abstract palette-action contribution shape.
 */
export const BATTLE_ROYALE_PALETTE_ACTIONS = {
  pluginId: PLUGIN_ID,
  items: BATTLE_ROYALE_AUTHORING_OBJECTS.map((object) => ({
    id: `battle-royale-${object.kind}`,
    objectKind: object.kind,
    label: object.label,
    description: object.description,
    icon: object.icon,
    placement: "sticky" as const,
  })),
};
