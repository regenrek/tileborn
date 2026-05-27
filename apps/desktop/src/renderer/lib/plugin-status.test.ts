import { describe, expect, it } from 'vitest';

import { formatPluginLifecycleStatus, resolvePluginLifecycleStatus } from './plugin-status';

describe('resolvePluginLifecycleStatus', () => {
  it('prefers failed when manifest loading fails', () => {
    expect(
      resolvePluginLifecycleStatus({
        enabled: true,
        version: '1.0.0',
        manifestFailed: true,
      }),
    ).toBe('failed');
  });

  it('marks stub installs as update available', () => {
    expect(
      resolvePluginLifecycleStatus({
        enabled: false,
        version: '0.0.0-stub',
        manifestFailed: false,
      }),
    ).toBe('update-available');
  });

  it('falls back to enabled/disabled', () => {
    expect(
      resolvePluginLifecycleStatus({
        enabled: true,
        version: '1.0.0',
        manifestFailed: false,
      }),
    ).toBe('enabled');
    expect(
      resolvePluginLifecycleStatus({
        enabled: false,
        version: '1.0.0',
        manifestFailed: false,
      }),
    ).toBe('disabled');
  });
});

describe('formatPluginLifecycleStatus', () => {
  it('formats lifecycle labels', () => {
    expect(formatPluginLifecycleStatus('update-available')).toBe('Update available');
    expect(formatPluginLifecycleStatus('failed')).toBe('Failed');
  });
});
