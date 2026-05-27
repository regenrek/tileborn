import { afterEach } from "vitest";

import { resetZoneSingleton } from "../ecs/zone.js";

afterEach(() => {
  resetZoneSingleton();
});
