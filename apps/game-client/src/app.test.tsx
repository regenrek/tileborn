import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const lobbySummary = (input: {
  readonly ready?: boolean;
  readonly canStart?: boolean;
  readonly playerId?: string;
  readonly displayName?: string;
} = {}) => ({
  roomId: "room-1",
  mapId: "map:fixture",
  phase: input.canStart ? "countdown" : "lobby",
  lobby: { visibility: "private", joinCode: "ABC234" },
  playerCount: 1,
  maxPlayers: 8,
  minReadyPlayers: 1,
  canStart: input.canStart ?? false,
  players: [
    {
      playerId: input.playerId ?? "player-1",
      status: "connected",
      ready: input.ready ?? false,
      reconnectEligible: true,
      lastSeenAt: "2026-06-13T00:00:00.000Z",
      displayName: input.displayName ?? "Ada",
    },
  ],
});

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

describe("game-client template App", () => {
  beforeEach(() => {
    const storage = createStorage();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
    vi.stubGlobal("localStorage", storage);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("boots into the neutral menu and surfaces the BR plugin sections", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/lobbies/create")) {
        return jsonResponse(
          {
            roomId: "room-1",
            wsUrl: "http://localhost/rooms/room-1/connect?playerId=player-1&token=handoff-1",
            joinCode: "ABC234",
            joinUrl: "http://localhost/lobbies/join?code=ABC234",
            playerId: "player-1",
            handoffToken: "handoff-1",
            reconnectToken: "reconnect-1",
            lobby: lobbySummary(),
          },
          201,
        );
      }
      if (url.endsWith("/lobbies/room-1/ready")) {
        return jsonResponse({
          lobby: lobbySummary({ ready: true, canStart: true }),
          canStart: true,
        });
      }
      throw new Error(`unexpected fetch ${url} ${String(init?.method)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("main-menu")).not.toBeNull());
    // Neutral brand title, not a product name.
    expect(screen.getByText("Tileborne Game")).not.toBeNull();
    // BR plugin contributed sections render into named slots.
    expect(screen.getByTestId("br-quick-play")).not.toBeNull();
    expect(screen.getByTestId("br-loadout")).not.toBeNull();
    expect(screen.getByTestId("br-private-room")).not.toBeNull();

    // BR quick-play drives the shell into the network lobby.
    await user.click(screen.getByTestId("br-quick-play"));
    expect(screen.getByTestId("lobby")).not.toBeNull();

    await user.type(screen.getByTestId("lobby-display-name"), "Ada");
    await user.click(screen.getByTestId("create-lobby"));
    await waitFor(() => expect(screen.getByTestId("lobby-code").textContent).toBe("ABC234"));
    expect(screen.getByTestId("lobby-ws-url").textContent).toBe(
      "ws://localhost/rooms/room-1/connect?token=redacted",
    );
    expect(screen.getByTestId("lobby-ws-url").textContent).not.toContain("handoff-1");
    const createCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/lobbies/create"));
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      mapId: "map:fixture",
      reserveCreator: true,
      playerDisplayName: "Ada",
    });
    expect(screen.getByTestId("lobby-player-player-1").textContent).toContain("Not ready");

    await user.click(screen.getByTestId("ready-toggle"));
    await waitFor(() => expect(screen.getByTestId("lobby-player-player-1").textContent).toContain("Ready"));
    const readyCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/lobbies/room-1/ready"));
    expect(JSON.parse(String(readyCall?.[1]?.body))).toEqual({
      playerId: "player-1",
      ready: true,
      reconnectToken: "reconnect-1",
    });

    await user.click(screen.getByTestId("start-match"));
    expect(screen.getByTestId("in-match")).not.toBeNull();
    await user.click(screen.getByTestId("end-match"));
    expect(screen.getByTestId("results-screen")).not.toBeNull();
  });

  it("shows the BR match-rules section inside settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("main-menu")).not.toBeNull());
    await user.click(screen.getByTestId("settings-button"));
    expect(screen.getByTestId("br-match-rules")).not.toBeNull();
  });

  it("joins a lobby by code with mocked fetch", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/lobbies/join")) {
        return jsonResponse(
          {
            roomId: "room-1",
            playerId: "player-2",
            wsUrl: "http://localhost/rooms/room-1/connect?playerId=player-2&token=handoff-2",
            handoffToken: "handoff-2",
            reconnectToken: "reconnect-2",
            lobby: lobbySummary({ playerId: "player-2", displayName: "Grace" }),
          },
          201,
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("main-menu")).not.toBeNull());
    await user.click(screen.getByTestId("br-quick-play"));
    await user.type(screen.getByTestId("lobby-display-name"), "Grace");
    await user.type(screen.getByTestId("lobby-join-code"), "abc234");
    await user.click(screen.getByTestId("join-lobby"));

    await waitFor(() => expect(screen.getByTestId("lobby-player-player-2").textContent).toContain("Grace"));
    const joinCall = fetchMock.mock.calls[0];
    expect(String(joinCall?.[0])).toMatch(/\/lobbies\/join$/);
    expect(JSON.parse(String(joinCall?.[1]?.body))).toEqual({
      joinCode: "ABC234",
      displayName: "Grace",
    });
  });

  it("reconnects from stored lobby credentials and stores the fresh reconnect token", async () => {
    window.localStorage.setItem(
      "tileborne.game-client.lobby-reconnect.v1",
      JSON.stringify({
        roomId: "room-1",
        playerId: "player-1",
        reconnectToken: "old-reconnect",
      }),
    );
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/rooms/reconnect")) {
        return jsonResponse({
          roomId: "room-1",
          playerId: "player-1",
          wsUrl: "http://localhost/rooms/room-1/connect?playerId=player-1&token=fresh-handoff",
          handoffToken: "fresh-handoff",
          reconnectToken: "fresh-reconnect",
          lobby: lobbySummary({ ready: true }),
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("main-menu")).not.toBeNull());
    await user.click(screen.getByTestId("br-quick-play"));
    expect(screen.getByTestId("lobby-reconnect-prompt").textContent).toContain("player-1");
    await user.click(screen.getByRole("button", { name: /reconnect/i }));

    await waitFor(() =>
      expect(screen.getByTestId("lobby-ws-url").textContent).toContain("ws://localhost/rooms/room-1/connect"),
    );
    expect(screen.getByTestId("lobby-ws-url").textContent).toContain("token=redacted");
    expect(screen.getByTestId("lobby-ws-url").textContent).not.toContain("fresh-handoff");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      roomId: "room-1",
      playerId: "player-1",
      reconnectToken: "old-reconnect",
    });
    expect(
      JSON.parse(String(window.localStorage.getItem("tileborne.game-client.lobby-reconnect.v1"))),
    ).toEqual({
      roomId: "room-1",
      playerId: "player-1",
      reconnectToken: "fresh-reconnect",
    });
  });
});
