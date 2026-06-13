import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { createGameHostLobbyClient, LobbyClientError } from "./lobby-client.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const lobby = {
  roomId: "room-1",
  mapId: "map:fixture",
  phase: "lobby",
  lobby: { visibility: "private", joinCode: "ABC234" },
  playerCount: 1,
  maxPlayers: 8,
  minReadyPlayers: 1,
  canStart: false,
  players: [
    {
      playerId: "player-1",
      status: "connected",
      ready: false,
      reconnectEligible: true,
      lastSeenAt: null,
    },
  ],
};

const repoRoot = path.resolve(process.cwd(), "../..");

const relativeImport = (fromDir: string, toFile: string): string => {
  const relative = path.relative(fromDir, toFile).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
};

const compileLobbyDtoContract = (): readonly string[] => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tileborne-lobby-contract-"));
  try {
    const contractFile = path.join(tempDir, "lobby-contract.ts");
    fs.writeFileSync(
      contractFile,
      `
import type {
  LobbyCreateRequest as HostLobbyCreateRequest,
  LobbyCreateResponse as HostLobbyCreateResponse,
  LobbyJoinRequest as HostLobbyJoinRequest,
  LobbyJoinResponse as HostLobbyJoinResponse,
  LobbyReadyRequest as HostLobbyReadyRequest,
  LobbyReadyResponse as HostLobbyReadyResponse,
  RoomLobbySummary as HostRoomLobbySummary,
  RoomReconnectRequest as HostRoomReconnectRequest,
  RoomReconnectResponse as HostRoomReconnectResponse,
} from "${relativeImport(tempDir, path.join(repoRoot, "apps/game-host/src/types.ts"))}";
import type {
  LobbyCreateRequest as ClientLobbyCreateRequest,
  LobbyCreateResponse as ClientLobbyCreateResponse,
  LobbyJoinRequest as ClientLobbyJoinRequest,
  LobbyJoinResponse as ClientLobbyJoinResponse,
  LobbyReadyRequest as ClientLobbyReadyRequest,
  LobbyReadyResponse as ClientLobbyReadyResponse,
  RoomLobbySummary as ClientRoomLobbySummary,
  RoomReconnectRequest as ClientRoomReconnectRequest,
  RoomReconnectResponse as ClientRoomReconnectResponse,
} from "${relativeImport(tempDir, path.join(repoRoot, "packages/game-client/src/lobby-client.ts"))}";

type AssertAssignable<Actual extends Expected, Expected> = true;

type LobbyContract = [
  AssertAssignable<ClientRoomLobbySummary, HostRoomLobbySummary>,
  AssertAssignable<HostRoomLobbySummary, ClientRoomLobbySummary>,
  AssertAssignable<ClientLobbyCreateRequest, HostLobbyCreateRequest>,
  AssertAssignable<HostLobbyCreateRequest, ClientLobbyCreateRequest>,
  AssertAssignable<ClientLobbyCreateResponse, HostLobbyCreateResponse>,
  AssertAssignable<HostLobbyCreateResponse, ClientLobbyCreateResponse>,
  AssertAssignable<ClientLobbyJoinRequest, HostLobbyJoinRequest>,
  AssertAssignable<HostLobbyJoinRequest, ClientLobbyJoinRequest>,
  AssertAssignable<ClientLobbyJoinResponse, HostLobbyJoinResponse>,
  AssertAssignable<HostLobbyJoinResponse, ClientLobbyJoinResponse>,
  AssertAssignable<ClientLobbyReadyRequest, HostLobbyReadyRequest>,
  AssertAssignable<HostLobbyReadyRequest, ClientLobbyReadyRequest>,
  AssertAssignable<ClientLobbyReadyResponse, HostLobbyReadyResponse>,
  AssertAssignable<HostLobbyReadyResponse, ClientLobbyReadyResponse>,
  AssertAssignable<ClientRoomReconnectRequest, HostRoomReconnectRequest>,
  AssertAssignable<HostRoomReconnectRequest, ClientRoomReconnectRequest>,
  AssertAssignable<ClientRoomReconnectResponse, HostRoomReconnectResponse>,
  AssertAssignable<HostRoomReconnectResponse, ClientRoomReconnectResponse>,
];

const contract: LobbyContract = [
  true, true, true, true, true, true, true, true, true,
  true, true, true, true, true, true, true, true, true,
];
void contract;
`,
    );
    const program = ts.createProgram({
      rootNames: [contractFile],
      options: {
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        noEmit: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        ignoreDeprecations: "6.0",
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
        types: ["@cloudflare/workers-types"],
        baseUrl: repoRoot,
        paths: {
          "@tileborne/core": ["./packages/core/src/index.ts"],
        },
      },
    });
    return ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

describe("createGameHostLobbyClient", () => {
  it("keeps lobby DTOs assignable to the host-owned contract", () => {
    expect(compileLobbyDtoContract()).toEqual([]);
  });

  it("wraps lobby create, join, ready, lookup, and reconnect endpoints", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/lobbies/create")) {
        return jsonResponse(
          {
            roomId: "room-1",
            wsUrl: "http://host/rooms/room-1/connect?token=handoff",
            joinCode: "ABC234",
            joinUrl: "http://host/lobbies/join?code=ABC234",
            playerId: "player-1",
            handoffToken: "handoff",
            reconnectToken: "reconnect",
            lobby,
          },
          201,
        );
      }
      if (url.endsWith("/lobbies/join")) {
        return jsonResponse(
          {
            roomId: "room-1",
            playerId: "player-2",
            wsUrl: "https://host/rooms/room-1/connect?token=handoff-2",
            handoffToken: "handoff-2",
            reconnectToken: "reconnect-2",
            lobby,
          },
          201,
        );
      }
      if (url.endsWith("/lobbies/room-1/ready")) {
        return jsonResponse({ lobby, canStart: false, reason: "waiting" });
      }
      if (url.endsWith("/lobbies/code/ABC234") || url.endsWith("/lobbies/room-1")) {
        return jsonResponse(lobby);
      }
      if (url.endsWith("/rooms/reconnect")) {
        return jsonResponse({
          roomId: "room-1",
          playerId: "player-1",
          wsUrl: "http://host/rooms/room-1/connect?token=fresh",
          handoffToken: "fresh",
          reconnectToken: "fresh-reconnect",
          lobby,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const client = createGameHostLobbyClient({ baseUrl: "http://host/", fetch });

    await expect(client.createLobby({ mapId: "map:fixture", reserveCreator: true })).resolves.toMatchObject({
      wsUrl: "ws://host/rooms/room-1/connect?token=handoff",
      joinCode: "ABC234",
    });
    await expect(client.joinLobby({ joinCode: "ABC234" })).resolves.toMatchObject({
      wsUrl: "wss://host/rooms/room-1/connect?token=handoff-2",
      playerId: "player-2",
    });
    await expect(
      client.setReady("room-1", {
        playerId: "player-1",
        ready: true,
        reconnectToken: "reconnect",
      }),
    ).resolves.toMatchObject({
      canStart: false,
      reason: "waiting",
    });
    await expect(client.getLobbyByCode("ABC234")).resolves.toMatchObject({ roomId: "room-1" });
    await expect(client.getLobby("room-1")).resolves.toMatchObject({ roomId: "room-1" });
    await expect(
      client.reconnect({ roomId: "room-1", playerId: "player-1", reconnectToken: "reconnect" }),
    ).resolves.toMatchObject({
      wsUrl: "ws://host/rooms/room-1/connect?token=fresh",
      reconnectToken: "fresh-reconnect",
    });

    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      "http://host/lobbies/create",
      "http://host/lobbies/join",
      "http://host/lobbies/room-1/ready",
      "http://host/lobbies/code/ABC234",
      "http://host/lobbies/room-1",
      "http://host/rooms/reconnect",
    ]);
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      playerId: "player-1",
      ready: true,
      reconnectToken: "reconnect",
    });
  });

  it("surfaces structured host errors", async () => {
    const client = createGameHostLobbyClient({
      baseUrl: "http://host",
      fetch: vi.fn(async () => jsonResponse({ error: "join code not found" }, 404)),
    });

    await expect(client.joinLobby({ joinCode: "ABC234" })).rejects.toMatchObject({
      name: "LobbyClientError",
      status: 404,
      message: "join code not found",
    } satisfies Partial<LobbyClientError>);
  });
});
