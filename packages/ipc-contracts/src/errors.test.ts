import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeIpcChannel } from './channel.js';
import {
  IPC_ERROR_COUNT,
  IpcDecodeError,
  IpcError,
  IpcPermissionDeniedError,
  IpcTimeoutError,
  IpcValidationError,
} from './errors.js';

describe('IPC errors', () => {
  it('instantiates tagged IPC errors', () => {
    const channel = makeIpcChannel('tileborne:project:open');
    const timeout = new IpcTimeoutError({
      channel,
      timeoutMs: 1_000,
      message: 'Timed out',
    });
    const validation = new IpcValidationError({
      channel: Option.some(channel),
      message: 'Invalid request',
      issues: ['missing projectId'],
    });

    expect(timeout._tag).toBe('IpcTimeoutError');
    expect(validation._tag).toBe('IpcValidationError');
  });

  it('decodes tagged IPC error variants', () => {
    const decoded = Schema.decodeUnknownSync(IpcError)({
      _tag: 'IpcPermissionDeniedError',
      channel: 'tileborne:system:openExternal',
      message: 'Approval required',
      reason: 'external-url',
    });

    expect(decoded).toBeInstanceOf(IpcPermissionDeniedError);
    expect(decoded._tag).toBe('IpcPermissionDeniedError');
  });

  it('tracks the v1 IPC-layer error count', () => {
    expect(IPC_ERROR_COUNT).toBe(8);
  });

  it('instantiates decode boundary errors', () => {
    const decode = new IpcDecodeError({
      channel: Option.none(),
      message: 'Invalid IPC response',
      issues: ['missing field'],
    });

    expect(decode._tag).toBe('IpcDecodeError');
  });
});
