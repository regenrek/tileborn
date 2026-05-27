import { getIpcError } from '@/lib/ipc';
import {
  notifyError,
  notifyInfo,
  notifySuccess,
  type AppNotificationKind,
} from '@/stores/app-notifications-store';

export interface MutationToastMeta {
  readonly silent?: boolean;
}

export function isMutationSilent(meta: MutationToastMeta | undefined): boolean {
  return meta?.silent === true;
}

export function isUserCancelledMutation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === 'Import cancelled' || error.message === 'Export cancelled')
  );
}

export function formatMutationError(
  error: unknown,
  action: string,
  retryHint?: string,
): string {
  const ipcError = getIpcError(error);
  const reason =
    ipcError?.message ??
    (error instanceof Error ? error.message : `Could not ${action.toLowerCase()}`);
  const prefix = `Failed to ${action.toLowerCase()}`;
  if (retryHint) {
    return `${prefix}: ${reason}. ${retryHint}`;
  }
  return `${prefix}: ${reason}`;
}

export function mutationToast(
  kind: AppNotificationKind,
  message: string,
  meta?: MutationToastMeta,
): void {
  if (isMutationSilent(meta)) {
    return;
  }
  switch (kind) {
    case 'success':
      notifySuccess(message);
      return;
    case 'error':
      notifyError(message);
      return;
    case 'info':
      notifyInfo(message);
  }
}

export function mutationSuccessToast(message: string, meta?: MutationToastMeta): void {
  mutationToast('success', message, meta);
}

export function mutationErrorToast(message: string, meta?: MutationToastMeta): void {
  mutationToast('error', message, meta);
}
