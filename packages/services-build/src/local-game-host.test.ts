import { createLocalGameHost } from "@tileborne/services-build/local-game-host";
import { describe, expect, it } from "vitest";

describe("createLocalGameHost", () => {
  it("serves /health on the bound port and releases it after stop()", async () => {
    const host = await createLocalGameHost({ port: 18080 });
    try {
      const response = await host.fetch(`${host.baseUrl}/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { readonly status: string };
      expect(body.status).toBe("ok");
      expect(host.signingKey.length).toBeGreaterThanOrEqual(32);
    } finally {
      await host.stop();
    }

    await expect(fetch("http://127.0.0.1:18080/health")).rejects.toThrow();
  });

  it("creates a multiplayer room via POST /rooms/create", async () => {
    const host = await createLocalGameHost({ port: 18081 });
    try {
      const createResponse = await host.fetch(`${host.baseUrl}/rooms/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapId: "map:launcher-smoke" }),
      });
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as { readonly roomId: string; readonly wsUrl: string };
      expect(created.roomId.length).toBeGreaterThan(0);
      expect(created.wsUrl).toContain(`/rooms/${created.roomId}/connect`);
    } finally {
      await host.stop();
    }
  });
});
