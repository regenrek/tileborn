import { writeFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, it } from 'vitest';
import { DEFAULT_RECONNECT_ATTEMPT_CAP, MATCH_ENDED_CLOSE_CODE } from '@tileborne/runtime/net';

import { expect } from './playwright-expect.js';
import {
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  resolveMainEntry,
  type SmokeContext,
} from './helpers.js';

const roomUrl = process.env.TILEBORNE_CLOUDFLARE_ROOM_URL;
const firstSessionJson = process.env.TILEBORNE_CLOUDFLARE_FIRST_SESSION;
const secondSessionJson = process.env.TILEBORNE_CLOUDFLARE_SECOND_SESSION;
const runId = process.env.TILEBORNE_CLOUDFLARE_RUN_ID ?? `remote-${Date.now()}`;
const evidencePath = process.env.TILEBORNE_CLOUDFLARE_ELECTRON_EVIDENCE;

interface TerminalPlayerResult {
  readonly playerId: string;
  readonly outcome?: string;
  readonly placement?: number;
}

interface TerminalRoomResults {
  readonly completedAt: string;
  readonly reason?: string;
  readonly players: readonly TerminalPlayerResult[];
}

interface TerminalSmokeState {
  readonly flowPhase: string | undefined;
  readonly lobbyState: unknown;
  readonly roomResults: TerminalRoomResults | null | undefined;
  readonly session: {
    readonly phase: string;
    readonly tick: number;
    readonly localPlayerId: string | null;
    readonly reconnectAttempts: number;
    readonly transportObservations: readonly unknown[];
    readonly errorMessage: string | null;
  } | null;
}

interface TransportCloseObservation {
  readonly _tag: 'close' | 'reconnectPredecessorClose';
  readonly code: number;
  readonly wasClean: boolean;
  readonly reconnectable?: boolean;
}

interface CloseTaggedObservation {
  readonly _tag: 'close' | 'reconnectPredecessorClose';
  readonly code?: unknown;
  readonly wasClean?: unknown;
  readonly reconnectable?: unknown;
}

const FORCED_NETWORK_DROP_CLOSE_CODE = 4000;
const CLEAN_RECONNECT_PREDECESSOR_CLOSE_CODE = 1000;
const RENDERER_CAPABILITY_ID = 'battle-royale.renderer';
const SMOKE_MAP_DIMENSION = 64;

const isCloseObservation = (observation: unknown): observation is TransportCloseObservation =>
  typeof observation === 'object' &&
  observation !== null &&
  ((observation as { readonly _tag?: unknown })._tag === 'close' ||
    (observation as { readonly _tag?: unknown })._tag === 'reconnectPredecessorClose') &&
  Number.isInteger((observation as { readonly code?: unknown }).code) &&
  typeof (observation as { readonly wasClean?: unknown }).wasClean === 'boolean';

const isCloseTaggedObservation = (observation: unknown): observation is CloseTaggedObservation =>
  typeof observation === 'object' &&
  observation !== null &&
  ((observation as { readonly _tag?: unknown })._tag === 'close' ||
    (observation as { readonly _tag?: unknown })._tag === 'reconnectPredecessorClose');

const classifyLifecycleCloseObservations = (
  observations: readonly unknown[],
): {
  readonly expectedCloseCodes: readonly number[];
  readonly abnormalExpectedCloseCodeObserved: boolean;
  readonly forcedNetworkDropCloseCodeObserved: number | undefined;
} => {
  const classifications = observations.filter(isCloseTaggedObservation).map((observation) => {
    if (
      observation._tag === 'reconnectPredecessorClose' &&
      observation.code === CLEAN_RECONNECT_PREDECESSOR_CLOSE_CODE &&
      observation.wasClean
    ) {
      return { kind: 'expected' as const, code: observation.code, abnormal: false, observation };
    }
    if (
      observation._tag === 'close' &&
      observation.code === MATCH_ENDED_CLOSE_CODE &&
      observation.wasClean &&
      observation.reconnectable === false
    ) {
      return { kind: 'expected' as const, code: observation.code, abnormal: false, observation };
    }
    if (
      observation._tag === 'close' &&
      observation.code === FORCED_NETWORK_DROP_CLOSE_CODE &&
      observation.reconnectable === true
    ) {
      return {
        kind: 'forced-network-drop' as const,
        code: observation.code,
        abnormal: false,
        observation,
      };
    }
    return { kind: 'unexpected' as const, code: observation.code, abnormal: true, observation };
  });
  const unexpected = classifications.filter(
    (classification) => classification.kind === 'unexpected',
  );
  if (unexpected.length > 0) {
    throw new Error(
      `unexpected close observations: ${JSON.stringify(
        unexpected.map((classification) => classification.observation),
      )}`,
    );
  }
  const expected = classifications.filter((classification) => classification.kind === 'expected');
  return {
    expectedCloseCodes: expected.map((classification) => classification.code),
    abnormalExpectedCloseCodeObserved: expected.some((classification) => classification.abnormal),
    forcedNetworkDropCloseCodeObserved: classifications.some(
      (classification) =>
        classification.kind === 'forced-network-drop' &&
        classification.code === FORCED_NETWORK_DROP_CLOSE_CODE,
    )
      ? FORCED_NETWORK_DROP_CLOSE_CODE
      : undefined,
  };
};

const localLobbyState = (context: SmokeContext, label: string) =>
  context.page.evaluate((clientLabel) => {
    const store = window.__tileborne_e2e?.getMultiplayerStoreState?.();
    const session = window.__tileborne_e2e?.getMultiplayerSessionState?.();
    const lobbyState = store?.lobbyState as
      | {
          readonly phase?: string;
          readonly players?: readonly {
            readonly playerId: string;
            readonly role?: string;
            readonly ready?: boolean;
            readonly status?: string;
          }[];
        }
      | undefined;
    const localPlayer = lobbyState?.players?.find(
      (player) => player.playerId === store.participantSession?.playerId,
    );
    return {
      label: clientLabel,
      flowPhase: store?.flowPhase,
      participantPlayerId: store?.participantSession?.playerId,
      localPlayerId: session?.localPlayerId ?? null,
      localReady: localPlayer?.ready ?? false,
      isReadyPending: store?.isReadyPending ?? false,
      lobbyPhase: lobbyState?.phase,
      readyPlayers: lobbyState?.players?.filter((player) => player.ready === true).length ?? 0,
      lobbyPlayers:
        lobbyState?.players?.map((player) => ({
          playerId: player.playerId,
          role: player.role,
          ready: player.ready,
          status: player.status,
        })) ?? [],
      errorMessage: session?.errorMessage ?? store?.lobbyError ?? null,
    };
  }, label);

const readyTransitionEvidence = async (
  first: SmokeContext,
  second: SmokeContext,
  expectedReadyPlayers: number,
) => {
  const { roomId } = remoteRoom();
  const [firstClient, secondClient, diagnostics] = await Promise.all([
    localLobbyState(first, 'client-a'),
    localLobbyState(second, 'client-b'),
    fetchRoomJson(`/rooms/${roomId}/diagnostics`),
  ]);
  const body = (diagnostics.body as { readonly diagnostics?: Record<string, unknown> } | null)
    ?.diagnostics;
  return {
    expectedReadyPlayers,
    server: {
      status: diagnostics.status,
      phase: body?.phase,
      playerCount: body?.playerCount,
      readyPlayerCount: body?.readyPlayerCount,
      connectedPlayerCount: body?.connectedPlayerCount,
      ownerPlayerId: body?.ownerPlayerId,
      issues: body?.issues,
    },
    clients: [firstClient, secondClient],
  };
};

const waitForReadyTransition = async (
  first: SmokeContext,
  second: SmokeContext,
  expectedReadyPlayers: number,
): Promise<Awaited<ReturnType<typeof readyTransitionEvidence>>> => {
  await expect
    .poll(() => readyTransitionEvidence(first, second, expectedReadyPlayers), {
      timeout: 60_000,
      intervals: [250, 500, 1_000],
    })
    .toMatchObject({
      server: {
        status: 200,
        playerCount: 2,
        readyPlayerCount: expectedReadyPlayers,
        connectedPlayerCount: 2,
        issues: [],
      },
      clients:
        expectedReadyPlayers === 1
          ? [
              { label: 'client-a', localReady: false, isReadyPending: false },
              { label: 'client-b', localReady: true, isReadyPending: false },
            ]
          : [
              { label: 'client-a', localReady: true, isReadyPending: false },
              { label: 'client-b', localReady: true, isReadyPending: false },
            ],
    });
  return readyTransitionEvidence(first, second, expectedReadyPlayers);
};

const createFreshBattleRoyaleClient = async (label: string): Promise<SmokeContext> => {
  const context = await launchElectron(await createTileborneHome());
  const created = await context.page.evaluate(
    ({ name, idempotencyKey }) =>
      window.tileborne.projects.createGame({
        name,
        gameType: 'battle-royale',
        idempotencyKey,
      }),
    {
      name: `Cloudflare ${label} ${runId}`,
      idempotencyKey: `cloudflare-${label}-${runId}`,
    },
  );
  await navigateToRoute(context.page, `/projects/${created.projectId}/maps/${created.mapId}`);
  await expect(context.page.getByTestId('br-setting-maxPlayers')).toBeVisible({
    timeout: 60_000,
  });
  return context;
};

interface ExplicitRemoteSession {
  readonly baseUrl: string;
  readonly roomId: string;
  readonly wsUrl: string;
  readonly playerId: string;
  readonly handoffToken: string;
  readonly reconnectToken: string;
}

const parseExplicitSession = (value: string | undefined, label: string): ExplicitRemoteSession => {
  if (value === undefined) {
    throw new Error(`${label} explicit session handoff is required`);
  }
  const parsed = JSON.parse(value) as Partial<ExplicitRemoteSession>;
  for (const key of ['baseUrl', 'roomId', 'wsUrl', 'playerId', 'handoffToken', 'reconnectToken']) {
    if (typeof parsed[key as keyof ExplicitRemoteSession] !== 'string') {
      throw new Error(`${label} explicit session handoff is missing ${key}`);
    }
  }
  return parsed as ExplicitRemoteSession;
};

const joinRemoteRoom = async (
  context: SmokeContext,
  session: ExplicitRemoteSession,
): Promise<void> => {
  const pageErrors: string[] = [];
  context.page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.page.evaluate(
    async ({ handoff, options }) => {
      const join = window.__tileborne_e2e?.joinMultiplayerSession;
      if (join === undefined) {
        throw new Error('explicit multiplayer session handoff hook is unavailable');
      }
      await join(handoff, options);
    },
    {
      handoff: session,
      options: {
        rendererCapabilityId: RENDERER_CAPABILITY_ID,
        mapId: 'cloudflare-smoke',
        mapWidth: SMOKE_MAP_DIMENSION,
        mapHeight: SMOKE_MAP_DIMENSION,
      },
    },
  );
  await context.page.waitForFunction(
    () =>
      document.querySelector('[data-testid="playtest-multiplayer-viewport"]') !== null ||
      window.__tileborne_e2e?.getMultiplayerStoreState?.().flowPhase === 'error',
    undefined,
    { timeout: 90_000 },
  );
  const joinState = await context.page.evaluate(() => ({
    store: window.__tileborne_e2e?.getMultiplayerStoreState?.(),
    session: window.__tileborne_e2e?.getMultiplayerSessionState?.(),
    notifications: [...document.querySelectorAll('[data-sonner-toast]')]
      .map((element) => element.textContent?.trim())
      .filter((message): message is string => message !== undefined && message.length > 0),
  }));
  if (joinState.store?.flowPhase === 'error') {
    await context.page.waitForTimeout(250);
    const settledJoinState = await context.page.evaluate(() => ({
      store: window.__tileborne_e2e?.getMultiplayerStoreState?.(),
      session: window.__tileborne_e2e?.getMultiplayerSessionState?.(),
      notifications: [...document.querySelectorAll('[data-sonner-toast]')]
        .map((element) => element.textContent?.trim())
        .filter((message): message is string => message !== undefined && message.length > 0),
    }));
    throw new Error(
      `remote room join failed: ${settledJoinState.store?.lobbyError ?? settledJoinState.session?.errorMessage ?? settledJoinState.notifications.at(-1) ?? pageErrors.at(-1) ?? 'unknown error'}`,
    );
  }
  await expect(context.page.getByTestId('playtest-multiplayer-viewport')).toBeVisible({
    timeout: 90_000,
  });
  await expect(context.page.getByTestId('multiplayer-lobby')).toBeVisible({ timeout: 30_000 });
};

const sessionState = (context: SmokeContext) =>
  context.page.evaluate(() => {
    const state = window.__tileborne_e2e?.getMultiplayerSessionState?.();
    return state === null || state === undefined
      ? undefined
      : {
          phase: state.phase,
          tick: state.tick,
          playerCount: state.hud.totalPlayers,
          localPlayerId: state.localPlayerId,
          reconnectAttempts: state.reconnectAttempts,
          transportObservations: state.transportObservations,
          errorMessage: state.errorMessage,
        };
  });

const terminalState = (context: SmokeContext): Promise<TerminalSmokeState> =>
  context.page.evaluate(() => {
    const store = window.__tileborne_e2e?.getMultiplayerStoreState?.();
    const session = window.__tileborne_e2e?.getMultiplayerSessionState?.();
    return {
      flowPhase: store?.flowPhase,
      lobbyState: store?.lobbyState,
      roomResults: store?.roomResults as TerminalRoomResults | null | undefined,
      session:
        session === null || session === undefined
          ? null
          : {
              phase: session.phase,
              tick: session.tick,
              localPlayerId: session.localPlayerId,
              reconnectAttempts: session.reconnectAttempts,
              transportObservations: session.transportObservations,
              errorMessage: session.errorMessage,
            },
    };
  });

const remoteRoom = () => {
  if (roomUrl === undefined) {
    throw new Error('TILEBORNE_CLOUDFLARE_ROOM_URL is required');
  }
  const url = new URL(roomUrl);
  const roomId = url.pathname.match(/\/rooms\/([^/?#]+)/)?.[1];
  if (roomId === undefined) {
    throw new Error(`unable to resolve room id from ${roomUrl}`);
  }
  return {
    endpoint: url.origin,
    roomId,
  };
};

const fetchRoomJson = async (path: string) => {
  const { endpoint } = remoteRoom();
  const response = await fetch(`${endpoint}${path}`);
  return {
    status: response.status,
    body: (await response.json()) as unknown,
  };
};

const postRoomJson = async (path: string, body: unknown) => {
  const { endpoint } = remoteRoom();
  const response = await fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as unknown,
  };
};

const persistEvidence = async (evidence: unknown): Promise<void> => {
  if (evidencePath === undefined) {
    return;
  }
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
};

describe('Cloudflare multiplayer lifecycle close oracle', () => {
  it('derives expected close evidence from exhaustive classification', () => {
    expect(
      classifyLifecycleCloseObservations([
        {
          _tag: 'close',
          code: FORCED_NETWORK_DROP_CLOSE_CODE,
          wasClean: false,
          reconnectable: true,
        },
        {
          _tag: 'reconnectPredecessorClose',
          code: CLEAN_RECONNECT_PREDECESSOR_CLOSE_CODE,
          wasClean: true,
          reconnectable: false,
        },
        {
          _tag: 'close',
          code: MATCH_ENDED_CLOSE_CODE,
          wasClean: true,
          reconnectable: false,
        },
      ]),
    ).toEqual({
      expectedCloseCodes: [CLEAN_RECONNECT_PREDECESSOR_CLOSE_CODE, MATCH_ENDED_CLOSE_CODE],
      abnormalExpectedCloseCodeObserved: false,
      forcedNetworkDropCloseCodeObserved: FORCED_NETWORK_DROP_CLOSE_CODE,
    });
  });

  it('rejects extra abnormal close observations', () => {
    expect(() =>
      classifyLifecycleCloseObservations([
        {
          _tag: 'close',
          code: FORCED_NETWORK_DROP_CLOSE_CODE,
          wasClean: false,
          reconnectable: true,
        },
        {
          _tag: 'close',
          code: 1006,
          wasClean: false,
          reconnectable: true,
        },
        {
          _tag: 'close',
          code: MATCH_ENDED_CLOSE_CODE,
          wasClean: true,
          reconnectable: false,
        },
      ]),
    ).toThrow(/unexpected close observations/);
  });
});

describe.runIf(roomUrl !== undefined)('disposable Cloudflare multiplayer lifecycle', () => {
  let first: SmokeContext | undefined;
  let second: SmokeContext | undefined;

  beforeAll(() => {
    resolveMainEntry();
  }, 120_000);

  afterAll(async () => {
    await Promise.all([disposeSmokeContext(first), disposeSmokeContext(second)]);
    first = undefined;
    second = undefined;
  });

  it('connects two fresh Electron clients and resumes authoritative ticks after a forced disconnect', async () => {
    const firstReservedSession = parseExplicitSession(firstSessionJson, 'first client');
    const secondReservedSession = parseExplicitSession(secondSessionJson, 'second client');
    const { roomId } = remoteRoom();
    expect(firstReservedSession.roomId).toBe(roomId);
    expect(secondReservedSession.roomId).toBe(roomId);
    expect(firstReservedSession.playerId).not.toBe(secondReservedSession.playerId);

    first = await createFreshBattleRoyaleClient('client-a');
    second = await createFreshBattleRoyaleClient('client-b');

    await joinRemoteRoom(first, firstReservedSession);
    await joinRemoteRoom(second, secondReservedSession);
    await expect
      .poll(() => localLobbyState(first!, 'client-a'))
      .toMatchObject({
        participantPlayerId: firstReservedSession.playerId,
        localPlayerId: firstReservedSession.playerId,
        lobbyPlayers: expect.arrayContaining([
          expect.objectContaining({
            playerId: firstReservedSession.playerId,
            role: 'owner',
          }),
          expect.objectContaining({
            playerId: secondReservedSession.playerId,
            role: 'participant',
          }),
        ]),
      });
    await expect
      .poll(() => localLobbyState(second!, 'client-b'))
      .toMatchObject({
        participantPlayerId: secondReservedSession.playerId,
        localPlayerId: secondReservedSession.playerId,
      });
    await second.page.getByTestId('multiplayer-ready-toggle').click();
    const oneReady = await waitForReadyTransition(first, second, 1);
    expect(oneReady.server.ownerPlayerId).toBe(firstReservedSession.playerId);
    expect(oneReady.clients.find((client) => client.label === 'client-b')?.localReady).toBe(true);
    expect(oneReady.clients.find((client) => client.label === 'client-a')?.localReady).toBe(false);

    await first.page.getByTestId('multiplayer-ready-toggle').click();
    const twoReady = await waitForReadyTransition(first, second, 2);
    expect(twoReady.server.ownerPlayerId).toBe(firstReservedSession.playerId);
    expect(twoReady.clients.every((client) => client.localReady)).toBe(true);
    await Promise.all([
      expect(first.page.getByTestId('multiplayer-lobby')).toBeHidden({ timeout: 60_000 }),
      expect(second.page.getByTestId('multiplayer-lobby')).toBeHidden({ timeout: 60_000 }),
    ]);

    await expect
      .poll(() => sessionState(second!), {
        timeout: 60_000,
        intervals: [250, 500, 1_000],
      })
      .toMatchObject({
        phase: 'live',
        tick: expect.any(Number),
        playerCount: 2,
        localPlayerId: expect.any(String),
        errorMessage: null,
      });
    const beforeDisconnect = await sessionState(second);
    expect(beforeDisconnect?.tick).toBeGreaterThan(0);
    expect(beforeDisconnect?.localPlayerId).toBeTruthy();

    const forcedDrop = await postRoomJson(
      `/__smoke/rooms/${encodeURIComponent(roomId)}/drop-participant-socket`,
      { playerId: secondReservedSession.playerId },
    );
    expect(forcedDrop.status).toBe(200);
    expect(forcedDrop.body).toMatchObject({
      roomId,
      playerId: secondReservedSession.playerId,
      closeCode: FORCED_NETWORK_DROP_CLOSE_CODE,
      reconnectEligible: true,
    });

    await expect
      .poll(
        async () =>
          (await sessionState(second!))?.transportObservations.filter(isCloseObservation) ?? [],
        {
          timeout: 60_000,
          intervals: [250, 500, 1_000],
        },
      )
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _tag: 'close',
            code: FORCED_NETWORK_DROP_CLOSE_CODE,
            reconnectable: true,
          }),
        ]),
      );

    await expect
      .poll(() => sessionState(second!), {
        timeout: 90_000,
        intervals: [250, 500, 1_000],
      })
      .toMatchObject({
        phase: 'live',
        playerCount: 2,
        localPlayerId: beforeDisconnect?.localPlayerId,
        errorMessage: null,
      });
    await expect
      .poll(async () => (await sessionState(second!))?.tick ?? 0, {
        timeout: 90_000,
        intervals: [250, 500, 1_000],
      })
      .toBeGreaterThan(beforeDisconnect?.tick ?? 0);

    const afterReconnect = await sessionState(second);
    expect(afterReconnect?.reconnectAttempts).toBeGreaterThanOrEqual(1);
    expect(afterReconnect?.reconnectAttempts).toBeLessThanOrEqual(DEFAULT_RECONNECT_ATTEMPT_CAP);
    expect(afterReconnect?.localPlayerId).toBe(beforeDisconnect?.localPlayerId);
    const reconnectDiagnostics = await fetchRoomJson(`/rooms/${roomId}/diagnostics`);
    const reconnectMetrics = await fetchRoomJson(`/rooms/${roomId}/metrics`);

    const [firstTerminal, secondTerminal] = await Promise.all([
      expect
        .poll(() => terminalState(first!), {
          timeout: 180_000,
          intervals: [500, 1_000, 2_000],
        })
        .toMatchObject({
          flowPhase: 'finished',
          roomResults: {
            players: expect.arrayContaining([
              expect.objectContaining({
                playerId: expect.any(String),
                outcome: expect.any(String),
                placement: expect.any(Number),
              }),
            ]),
          },
          session: {
            localPlayerId: expect.any(String),
            errorMessage: null,
          },
        })
        .then(() => terminalState(first!)),
      expect
        .poll(() => terminalState(second!), {
          timeout: 180_000,
          intervals: [500, 1_000, 2_000],
        })
        .toMatchObject({
          flowPhase: 'finished',
          roomResults: {
            players: expect.arrayContaining([
              expect.objectContaining({
                playerId: expect.any(String),
                outcome: expect.any(String),
                placement: expect.any(Number),
              }),
            ]),
          },
          session: {
            localPlayerId: beforeDisconnect?.localPlayerId,
            errorMessage: null,
          },
        })
        .then(() => terminalState(second!)),
    ]);

    const resultPlayers = firstTerminal.roomResults?.players ?? [];
    expect(resultPlayers).toHaveLength(2);
    expect(new Set(resultPlayers.map((player) => player.playerId)).size).toBe(2);
    expect(resultPlayers.map((player) => player.placement).sort()).toEqual([1, 2]);
    expect(resultPlayers.map((player) => player.outcome)).toEqual(['completed', 'completed']);
    expect(secondTerminal.roomResults).toEqual(firstTerminal.roomResults);
    expect(firstTerminal.session?.localPlayerId).not.toBe(secondTerminal.session?.localPlayerId);
    const readTerminalCloseObservations = async (): Promise<{
      readonly first: readonly TransportCloseObservation[];
      readonly second: readonly TransportCloseObservation[];
      readonly all: readonly TransportCloseObservation[];
    }> => {
      const [firstState, secondState] = await Promise.all([
        terminalState(first!),
        terminalState(second!),
      ]);
      const firstObservations = (firstState.session?.transportObservations ?? []).filter(
        isCloseObservation,
      );
      const secondObservations = (secondState.session?.transportObservations ?? []).filter(
        isCloseObservation,
      );
      return {
        first: firstObservations,
        second: secondObservations,
        all: [...firstObservations, ...secondObservations],
      };
    };
    await expect
      .poll(readTerminalCloseObservations, {
        timeout: 60_000,
        intervals: [250, 500, 1_000],
      })
      .toEqual(
        expect.objectContaining({
          first: expect.arrayContaining([
            expect.objectContaining({
              _tag: 'close',
              code: MATCH_ENDED_CLOSE_CODE,
              wasClean: true,
              reconnectable: false,
            }),
          ]),
          second: expect.arrayContaining([
            expect.objectContaining({
              _tag: 'close',
              code: FORCED_NETWORK_DROP_CLOSE_CODE,
              reconnectable: true,
            }),
            expect.objectContaining({
              _tag: 'close',
              code: MATCH_ENDED_CLOSE_CODE,
              wasClean: true,
              reconnectable: false,
            }),
          ]),
        }),
      );
    const terminalCloseObservations = await readTerminalCloseObservations();
    expect(
      terminalCloseObservations.first.some(
        (observation) => observation.code === FORCED_NETWORK_DROP_CLOSE_CODE,
      ),
    ).toBe(false);
    expect(
      terminalCloseObservations.all
        .filter((observation) => observation._tag === 'reconnectPredecessorClose')
        .every(
          (observation) =>
            observation.code === CLEAN_RECONNECT_PREDECESSOR_CLOSE_CODE && observation.wasClean,
        ),
    ).toBe(true);
    expect(
      terminalCloseObservations.all.some(
        (observation) =>
          observation._tag === 'reconnectPredecessorClose' &&
          observation.code === FORCED_NETWORK_DROP_CLOSE_CODE,
      ),
    ).toBe(false);
    const forcedDropCloseObservations = terminalCloseObservations.all.filter(
      (observation) => observation.code === FORCED_NETWORK_DROP_CLOSE_CODE,
    );
    expect(
      forcedDropCloseObservations.every(
        (observation) => observation._tag === 'close' && observation.reconnectable === true,
      ),
    ).toBe(true);
    const lifecycleCloseClassification = classifyLifecycleCloseObservations([
      ...(afterReconnect?.transportObservations ?? []),
      ...terminalCloseObservations.all,
    ]);
    expect(lifecycleCloseClassification.forcedNetworkDropCloseCodeObserved).toBe(
      FORCED_NETWORK_DROP_CLOSE_CODE,
    );
    expect(lifecycleCloseClassification.abnormalExpectedCloseCodeObserved).toBe(false);
    await persistEvidence({
      runId,
      roomId,
      readyTransitions: {
        oneReady,
        twoReady,
      },
      explicitSessions: {
        firstPlayerId: firstReservedSession.playerId,
        secondPlayerId: secondReservedSession.playerId,
      },
      reconnect: {
        beforeDisconnect,
        afterReconnect,
        forcedDrop,
        diagnostics: reconnectDiagnostics,
        metrics: reconnectMetrics,
      },
      terminal: {
        first: firstTerminal,
        second: secondTerminal,
        closeObservations: terminalCloseObservations,
      },
      lifecycleCloseClassification,
    });
  }, 300_000);
});
