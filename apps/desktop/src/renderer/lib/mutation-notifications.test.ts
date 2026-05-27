import { describe, expect, it } from 'vitest';

import { TileborneQueryError } from '@/lib/ipc';
import {
  formatMutationError,
  isMutationSilent,
  isUserCancelledMutation,
  mutationErrorToast,
  mutationSuccessToast,
} from '@/lib/mutation-notifications';
import { useAppNotificationsStore } from '@/stores/app-notifications-store';

describe('mutation-notifications', () => {
  it('detects user-cancelled picker flows', () => {
    expect(isUserCancelledMutation(new Error('Import cancelled'))).toBe(true);
    expect(isUserCancelledMutation(new Error('Export cancelled'))).toBe(true);
    expect(isUserCancelledMutation(new Error('IPC request failed'))).toBe(false);
  });

  it('respects silent mutation meta', () => {
    expect(isMutationSilent(undefined)).toBe(false);
    expect(isMutationSilent({ silent: true })).toBe(true);
  });

  it('formats IPC mutation errors with retry hints', () => {
    const error = new TileborneQueryError({
      _tag: 'IpcValidationError',
      message: 'invalid manifest',
    });
    expect(formatMutationError(error, 'import pack', 'Check the .json')).toBe(
      'Failed to import pack: invalid manifest. Check the .json',
    );
  });

  it('skips toast emission when silent', () => {
    useAppNotificationsStore.setState({ notifications: [] });
    mutationSuccessToast('Map created', { silent: true });
    mutationErrorToast('Failed', { silent: true });
    expect(useAppNotificationsStore.getState().notifications).toEqual([]);
  });

  it('emits success and error toasts', () => {
    useAppNotificationsStore.setState({ notifications: [] });
    mutationSuccessToast('Build started');
    mutationErrorToast('Failed to start build');
    expect(useAppNotificationsStore.getState().notifications).toHaveLength(2);
    expect(useAppNotificationsStore.getState().notifications[0]?.kind).toBe('success');
    expect(useAppNotificationsStore.getState().notifications[1]?.kind).toBe('error');
  });
});
