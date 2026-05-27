import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { findAvailablePort, isPortAvailable } from "./listen-port.js";

describe("listen-port", () => {
  it("findAvailablePort returns preferred port when free", async () => {
    const port = await findAvailablePort(0);
    expect(port).toBeGreaterThan(0);
  });

  it("findAvailablePort auto-picks when preferred port is busy", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.listen(0, "127.0.0.1", () => resolve());
      blocker.once("error", reject);
    });
    const address = blocker.address();
    const busyPort = typeof address === "object" && address ? address.port : 0;
    expect(busyPort).toBeGreaterThan(0);
    expect(await isPortAvailable(busyPort)).toBe(false);

    const picked = await findAvailablePort(busyPort);
    expect(picked).not.toBe(busyPort);
    expect(picked).toBeGreaterThan(0);

    await new Promise<void>((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));
  });
});
