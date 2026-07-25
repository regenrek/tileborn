const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const safeBodySnippet = (text) => text.replace(/\s+/g, ' ').trim().slice(0, 500);

export class ProofRouteError extends Error {
  constructor(route, status, bodyText, contentType) {
    const body = safeBodySnippet(bodyText);
    super(`${route} failed ${status}${body.length === 0 ? '' : `: ${body}`}`);
    this.name = 'ProofRouteError';
    this.route = route;
    this.status = status;
    this.bodyText = bodyText;
    this.contentType = contentType;
  }
}

export class NonRetryableProofError extends Error {
  constructor(message, options) {
    super(message);
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    this.name = 'NonRetryableProofError';
  }
}

export class WebSocketProofError extends Error {
  constructor(message, options = {}) {
    super(message);
    if (options.closeCode !== undefined) {
      this.closeCode = options.closeCode;
    }
    this.name = 'WebSocketProofError';
    this.deterministic = options.deterministic === true;
  }
}

export const isRetryableProofError = (error) => {
  if (error instanceof NonRetryableProofError) {
    return false;
  }
  if (error instanceof ProofRouteError) {
    return error.status >= 500;
  }
  return true;
};

const isPendingWorkersDevRoute = (error) =>
  error instanceof ProofRouteError &&
  error.status === 404 &&
  error.contentType.toLowerCase().includes('text/html') &&
  /workers\.cloudflare\.com|<title>Page not found<\/title>/i.test(error.bodyText);

export const jsonFetch = async (baseUrl, route, init, fetchImpl = fetch) => {
  const response = await fetchImpl(new URL(route, baseUrl), init);
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    throw new ProofRouteError(route, response.status, text, contentType);
  }

  if (text.length === 0) {
    return { status: response.status, body: null };
  }

  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch (error) {
    throw new NonRetryableProofError(
      `${route} returned non-JSON ${response.status}: ${safeBodySnippet(text)}`,
      { cause: error },
    );
  }
};

export const waitFor = async (operation, predicate, label, timeoutMs = 90_000, options = {}) => {
  const deadline = Date.now() + timeoutMs;
  const sleep = options.sleep ?? defaultSleep;
  const intervalMs = options.intervalMs ?? 500;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await operation();
      if (predicate(last)) return last;
    } catch (error) {
      if (options.shouldRetry !== undefined && !options.shouldRetry(error)) {
        throw error;
      }
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
};

export const normalizeWebSocketUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  }
  return url.toString();
};

export const safeWebSocketLabel = (rawUrl) => {
  const url = new URL(normalizeWebSocketUrl(rawUrl));
  return `${url.protocol}//${url.host}${url.pathname}`;
};

const deterministicWebSocketCloseCodes = new Set([1002, 1003, 1008]);

const isDeterministicWebSocketError = (error) =>
  error instanceof WebSocketProofError && error.deterministic === true;

const connectWebSocketOnce = (rawUrl, options = {}) => {
  const normalizedUrl = normalizeWebSocketUrl(rawUrl);
  const label = safeWebSocketLabel(normalizedUrl);
  const WebSocketImpl = options.WebSocket ?? WebSocket;
  const timeoutMs = options.handshakeTimeoutMs ?? 10_000;

  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    let messages = 0;
    let timer;

    const cleanupHandshakeListeners = () => {
      clearTimeout(timer);
      socket?.removeEventListener?.('open', onOpen);
      socket?.removeEventListener?.('error', onError);
      socket?.removeEventListener?.('close', onClose);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanupHandshakeListeners();
      socket?.removeEventListener?.('message', onMessage);
      try {
        socket?.close?.();
      } catch {
        // Ignore cleanup failures; the redacted proof error is the useful signal.
      }
      reject(error);
    };
    const onMessage = () => {
      messages += 1;
    };
    const onOpen = () => {
      if (settled) return;
      settled = true;
      cleanupHandshakeListeners();
      resolve({ socket, messageCount: () => messages });
    };
    const onError = () => {
      fail(new WebSocketProofError(`websocket handshake failed: ${label}`));
    };
    const onClose = (event) => {
      const code = typeof event?.code === 'number' ? event.code : undefined;
      const deterministic = code !== undefined && deterministicWebSocketCloseCodes.has(code);
      fail(
        new WebSocketProofError(
          `websocket closed before open${code === undefined ? '' : ` (${code})`}: ${label}`,
          { closeCode: code, deterministic },
        ),
      );
    };

    try {
      socket = new WebSocketImpl(normalizedUrl);
    } catch (error) {
      fail(new WebSocketProofError(`websocket constructor failed: ${label}`));
      return;
    }

    socket.addEventListener('message', onMessage);
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('error', onError, { once: true });
    socket.addEventListener('close', onClose, { once: true });
    timer = setTimeout(
      () => fail(new WebSocketProofError(`websocket handshake timeout: ${label}`)),
      timeoutMs,
    );
  });
};

export const connectWebSocketWithRetry = (rawUrl, options = {}) =>
  waitFor(
    () => connectWebSocketOnce(rawUrl, options),
    () => true,
    `websocket ${safeWebSocketLabel(rawUrl)}`,
    options.timeoutMs ?? 90_000,
    {
      sleep: options.sleep,
      intervalMs: options.intervalMs,
      shouldRetry: (error) => !isDeterministicWebSocketError(error),
    },
  );

export const createRoomWithRetry = async (endpoint, input, options = {}) =>
  waitFor(
    async () => {
      const response = await jsonFetch(
        endpoint,
        '/rooms/create',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mapId: input.mapId,
            seed: input.seed,
            options: { idempotencyKey: input.idempotencyKey },
          }),
        },
        options.fetch,
      );
      if (response.status !== 201 || typeof response.body?.roomId !== 'string') {
        throw new NonRetryableProofError(
          `/rooms/create returned ${response.status} without a roomId`,
        );
      }
      return response;
    },
    () => true,
    'created room',
    options.timeoutMs ?? 90_000,
    {
      sleep: options.sleep,
      intervalMs: options.intervalMs,
      shouldRetry: (error) => isPendingWorkersDevRoute(error) || isRetryableProofError(error),
    },
  );

export const assertMatchingReconnectLocalPlayerIds = (reconnect) => {
  const beforeLocalPlayerId = reconnect?.beforeDisconnect?.localPlayerId;
  const afterLocalPlayerId = reconnect?.afterReconnect?.localPlayerId;
  if (
    typeof beforeLocalPlayerId !== 'string' ||
    beforeLocalPlayerId.length === 0 ||
    typeof afterLocalPlayerId !== 'string' ||
    afterLocalPlayerId.length === 0
  ) {
    throw new Error(`electron reconnect identity missing: ${JSON.stringify(reconnect)}`);
  }
  if (afterLocalPlayerId !== beforeLocalPlayerId) {
    throw new Error(`electron reconnect identity changed: ${JSON.stringify(reconnect)}`);
  }
  return afterLocalPlayerId;
};

const observationCode = (observation) =>
  typeof observation === 'object' && observation !== null && Number.isInteger(observation.code)
    ? observation.code
    : undefined;

const observationWasClean = (observation) =>
  typeof observation === 'object' &&
  observation !== null &&
  typeof observation.wasClean === 'boolean'
    ? observation.wasClean
    : undefined;

const observationReconnectable = (observation) =>
  typeof observation === 'object' &&
  observation !== null &&
  typeof observation.reconnectable === 'boolean'
    ? observation.reconnectable
    : undefined;

const observationTag = (observation) =>
  typeof observation === 'object' && observation !== null ? observation._tag : undefined;

const isCloseObservation = (observation) => {
  const tag = observationTag(observation);
  return tag === 'close' || tag === 'reconnectPredecessorClose';
};

const classifyLifecycleCloseObservation = (observation, options) => {
  const tag = observationTag(observation);
  const code = observationCode(observation);
  const wasClean = observationWasClean(observation);
  const reconnectable = observationReconnectable(observation);
  if (
    tag === 'reconnectPredecessorClose' &&
    code === options.cleanReconnectPredecessorCloseCode &&
    wasClean === true
  ) {
    return { kind: 'expected', code, abnormal: false };
  }
  if (
    tag === 'close' &&
    code === options.matchEndedCloseCode &&
    wasClean === true &&
    reconnectable === false
  ) {
    return { kind: 'expected', code, abnormal: false };
  }
  if (tag === 'close' && code === options.forcedNetworkDropCloseCode && reconnectable === true) {
    return { kind: 'forced-network-drop', code, abnormal: false };
  }
  return { kind: 'unexpected', code, abnormal: true };
};

export const classifyElectronLifecycleCloseObservations = ({
  afterReconnect,
  terminalFirst,
  terminalSecond,
  forcedNetworkDropCloseCode = 4000,
  matchEndedCloseCode = 4006,
  cleanReconnectPredecessorCloseCode = 1000,
}) => {
  const options = {
    forcedNetworkDropCloseCode,
    matchEndedCloseCode,
    cleanReconnectPredecessorCloseCode,
  };
  const closeObservations = [
    ...(Array.isArray(afterReconnect) ? afterReconnect : []),
    ...(Array.isArray(terminalFirst) ? terminalFirst : []),
    ...(Array.isArray(terminalSecond) ? terminalSecond : []),
  ].filter(isCloseObservation);
  const classifications = closeObservations.map((observation) => ({
    observation,
    ...classifyLifecycleCloseObservation(observation, options),
  }));
  const unexpected = classifications.filter(
    (classification) => classification.kind === 'unexpected',
  );
  if (unexpected.length > 0) {
    throw new Error(
      `electron lifecycle unexpected close observations: ${JSON.stringify(
        unexpected.map((classification) => classification.observation),
      )}`,
    );
  }
  const expected = classifications.filter((classification) => classification.kind === 'expected');
  return {
    expectedCloseCodes: expected.map((classification) => classification.code),
    abnormalExpectedCloseCodeObserved: expected.some(
      (classification) => classification.abnormal === true,
    ),
    forcedNetworkDropCloseCodeObserved: classifications.some(
      (classification) =>
        classification.kind === 'forced-network-drop' &&
        classification.code === forcedNetworkDropCloseCode,
    )
      ? forcedNetworkDropCloseCode
      : undefined,
  };
};

export const summarizeMatchCompleteResults = (
  payload,
  requiredPlayerIds = ['player-1', 'player-2'],
) => {
  const results = payload?.body?.results;
  if (typeof results !== 'object' || results === null || results.reason !== 'match complete') {
    return undefined;
  }
  if (!Array.isArray(results.players)) {
    return undefined;
  }

  const players = requiredPlayerIds
    .map((playerId) => results.players.find((candidate) => candidate?.playerId === playerId))
    .filter((player) => player !== undefined);
  if (players.length !== requiredPlayerIds.length) {
    return undefined;
  }
  if (
    players.some(
      (player) =>
        player.outcome !== 'completed' ||
        !Number.isInteger(player.placement) ||
        player.placement < 1,
    )
  ) {
    return undefined;
  }

  const winners = players.filter((player) => player.placement === 1);
  if (winners.length !== 1) {
    return undefined;
  }
  const placements = new Set(players.map((player) => player.placement));
  if (placements.size !== players.length || !placements.has(1) || !placements.has(2)) {
    return undefined;
  }

  return {
    reason: results.reason,
    winnerPlayerId: winners[0].playerId,
    winnerSource: 'placement-1',
    players: players.map((player) => ({
      playerId: player.playerId,
      outcome: player.outcome,
      placement: player.placement,
    })),
  };
};
