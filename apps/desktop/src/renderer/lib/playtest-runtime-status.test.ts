import { describe, expect, it } from 'vitest';
import { PLUGIN_ID } from '@tileborne/plugin-battle-royale/constants';

import {
  formatPlaytestRuntimeStatus,
  isPlaytestStartupFailed,
  parseStartupFailedReason,
  PLAYTEST_RUNTIME_STARTING_MESSAGE,
  resolvePlaytestConnectionStatus,
  resolvePlaytestPluginName,
} from './playtest-runtime-status';

describe('playtest runtime status', () => {
  it('formats plugin activity for the overlay', () => {
    expect(
      formatPlaytestRuntimeStatus(PLUGIN_ID, {
        lastPluginEvent: 'onTick:3',
        tickCount: 3,
        playerCount: 2,
      }),
    ).toBe(`Plugin ${PLUGIN_ID} · onTick:3 · Tick 3 · Players: 2`);
  });

  it('formats startup failures with the plugin reason', () => {
    expect(
      formatPlaytestRuntimeStatus(PLUGIN_ID, {
        lastPluginEvent: 'startup-failed: module not found',
        tickCount: 0,
        playerCount: 0,
      }),
    ).toBe(`Plugin ${PLUGIN_ID} · startup failed · module not found`);
  });

  it('detects and parses startup failure events', () => {
    expect(isPlaytestStartupFailed('startup-failed: timeout')).toBe(true);
    expect(isPlaytestStartupFailed('onTick:1')).toBe(false);
    expect(parseStartupFailedReason('startup-failed: timeout')).toBe('timeout');
  });

  it('resolves connection status from session state', () => {
    expect(resolvePlaytestConnectionStatus(undefined)).toBe('idle');
    expect(
      resolvePlaytestConnectionStatus({ status: 'Starting', runtimeMetrics: undefined }),
    ).toBe('connecting');
    expect(
      resolvePlaytestConnectionStatus({
        status: 'Running',
        runtimeMetrics: {
          lastPluginEvent: 'onTick:1',
          tickCount: 1,
          playerCount: 0,
        },
      }),
    ).toBe('live');
    expect(
      resolvePlaytestConnectionStatus({
        status: 'Running',
        runtimeMetrics: {
          lastPluginEvent: 'startup-failed: boom',
          tickCount: 0,
          playerCount: 0,
        },
      }),
    ).toBe('error');
    expect(resolvePlaytestConnectionStatus({ status: 'Stopped' })).toBe('disconnected');
  });

  it('uses the first active plugin name', () => {
    expect(resolvePlaytestPluginName([PLUGIN_ID, 'other'])).toBe(PLUGIN_ID);
    expect(resolvePlaytestPluginName([])).toBe('unknown');
  });

  it('keeps the starting message constant', () => {
    expect(PLAYTEST_RUNTIME_STARTING_MESSAGE).toBe('Starting plugin runtime…');
  });
});
