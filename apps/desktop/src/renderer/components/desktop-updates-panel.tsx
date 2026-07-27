import type { DesktopUpdateState } from '@tileborne/ipc-contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  cn,
  typography,
} from '@tileborne/ui';
import { CheckCircle2Icon, DownloadIcon, RefreshCwIcon, RotateCcwIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useDesktopUpdates } from '@/hooks/use-desktop-updates';
import { requestAllDocumentsClose } from '@/lib/document-lifecycle';
import { notifyError, notifyInfo, notifySuccess } from '@/stores/app-notifications-store';

const RETRYABLE_UPDATE_ERROR_CODES = new Set<NonNullable<DesktopUpdateState['diagnostic']>['code']>(
  ['download-failed', 'feed-unavailable', 'invalid-feed', 'signature-failed', 'updater-error'],
);

const isRetryableUpdateError = (state: DesktopUpdateState): boolean =>
  state.state === 'error' &&
  state.diagnostic !== undefined &&
  RETRYABLE_UPDATE_ERROR_CODES.has(state.diagnostic.code);

const updateErrorRecoveryMessage = (state: DesktopUpdateState): string | undefined => {
  if (state.state !== 'error' || state.diagnostic === undefined || isRetryableUpdateError(state)) {
    return undefined;
  }

  switch (state.diagnostic.code) {
    case 'invalid-version':
      return 'Install a stable SemVer Tileborne release, then check updates again from that build.';
    case 'non-newer-version':
      return 'The release feed does not contain a newer build. Keep this version or install the desired release manually.';
    case 'policy-mismatch':
      return 'Use a release signed for the Tileborne macOS arm64 channel. Do not install this candidate.';
    case 'restart-cancelled':
      return 'Quit and reopen Tileborne to reset the update state, then check for updates again.';
    case 'unsupported-build':
      return 'Automatic updates only run in the signed macOS arm64 release build.';
    case 'download-failed':
    case 'feed-unavailable':
    case 'invalid-feed':
    case 'signature-failed':
    case 'updater-error':
      return undefined;
  }
};

const stateLabel = (state: DesktopUpdateState): string => {
  switch (state.state) {
    case 'disabled':
      return 'Unavailable';
    case 'idle':
      return 'Ready to check';
    case 'checking':
      return 'Checking';
    case 'available':
    case 'downloading':
      return 'Downloading';
    case 'ready':
      return 'Ready to restart';
    case 'up-to-date':
      return 'Up to date';
    case 'error':
      return 'Needs attention';
  }
};

const stateMessage = (state: DesktopUpdateState): string => {
  switch (state.state) {
    case 'disabled':
      return state.diagnostic?.message ?? 'Automatic updates are not available for this build.';
    case 'idle':
      return 'Automatic updates use the signed macOS arm64 release channel.';
    case 'checking':
      return 'Looking for a signed Tileborne update.';
    case 'available':
      return 'A signed update is available and will download in the background.';
    case 'downloading':
      return 'Downloading the signed update.';
    case 'ready':
      return `Tileborne ${state.targetVersion ?? 'update'} is staged and ready.`;
    case 'up-to-date':
      return 'You are running the latest available version.';
    case 'error':
      return state.diagnostic?.message ?? 'The update check failed.';
  }
};

const badgeVariant = (
  state: DesktopUpdateState['state'],
): 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' =>
  state === 'ready'
    ? 'success'
    : state === 'error'
      ? 'destructive'
      : state === 'checking' || state === 'downloading' || state === 'available'
        ? 'warning'
        : state === 'up-to-date'
          ? 'success'
          : state === 'disabled'
            ? 'outline'
            : 'secondary';

const formatLastCheckedAt = (lastCheckedAt: string | undefined): string => {
  if (lastCheckedAt === undefined) return 'Never';
  const date = new Date(lastCheckedAt);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
};

export function DesktopUpdatesPanel({
  confirm = globalThis.confirm,
}: {
  readonly confirm?: (message: string) => boolean;
}) {
  const { state, check, restart } = useDesktopUpdates();
  const [pendingAction, setPendingAction] = useState<'check' | 'restart' | undefined>();
  const [laterDismissedVersion, setLaterDismissedVersion] = useState<string | undefined>();
  const announcedStateRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const notificationKey = `${state.state}:${state.targetVersion ?? ''}:${state.diagnostic?.code ?? ''}`;
    if (notificationKey === announcedStateRef.current) return;
    announcedStateRef.current = notificationKey;
    if (state.state === 'ready' && state.targetVersion !== laterDismissedVersion) {
      notifyInfo(`Tileborne ${state.targetVersion ?? 'update'} is ready to install.`);
    } else if (state.state === 'up-to-date') {
      notifySuccess('Tileborne is up to date.');
    } else if (state.state === 'error') {
      notifyError(state.diagnostic?.message ?? 'Tileborne update check failed.');
    }
  }, [laterDismissedVersion, state]);

  const handleCheck = async (): Promise<void> => {
    setPendingAction('check');
    try {
      await check();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Tileborne update check failed.');
    } finally {
      setPendingAction(undefined);
    }
  };

  const handleRestart = async (): Promise<void> => {
    setPendingAction('restart');
    try {
      const allowClose = await requestAllDocumentsClose(confirm);
      if (!allowClose) {
        notifyInfo('Update restart cancelled. The staged update remains available.');
        return;
      }
      await restart();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Tileborne update restart failed.');
    } finally {
      setPendingAction(undefined);
    }
  };

  const retryableUpdateError = isRetryableUpdateError(state);
  const canCheck = state.state === 'idle' || state.state === 'up-to-date' || retryableUpdateError;
  const canRestart = state.state === 'ready';
  const recoveryMessage = updateErrorRecoveryMessage(state);
  const progress = state.progress?.percent;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Updates</CardTitle>
            <CardDescription>Signed macOS arm64 updates.</CardDescription>
          </div>
          <Badge variant={badgeVariant(state.state)}>{stateLabel(state)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="status" aria-live="polite" className="space-y-1">
          <p className={typography.bodyCompact}>{stateMessage(state)}</p>
          <p className={cn(typography.bodyMicro, 'text-muted-foreground')}>
            Current version {state.currentVersion}
            {state.targetVersion === undefined ? '' : ` · Available ${state.targetVersion}`}
          </p>
          <p className={cn(typography.bodyMicro, 'text-muted-foreground')}>
            Last checked {formatLastCheckedAt(state.lastCheckedAt)}
          </p>
        </div>

        {progress === undefined ? null : (
          <div className="space-y-1">
            <Progress value={progress} aria-label="Update download progress" />
            <p className={typography.bodyMicro}>{Math.round(progress)}% downloaded</p>
          </div>
        )}

        {recoveryMessage === undefined ? null : (
          <Alert className="border-destructive/40 bg-destructive/5">
            <AlertTitle className="text-destructive">Recovery required</AlertTitle>
            <AlertDescription>{recoveryMessage}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          {canCheck ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleCheck}
              disabled={pendingAction !== undefined}
            >
              {pendingAction === 'check' ? (
                <RefreshCwIcon className="size-4 animate-spin" aria-hidden />
              ) : state.state === 'up-to-date' ? (
                <CheckCircle2Icon className="size-4" aria-hidden />
              ) : (
                <DownloadIcon className="size-4" aria-hidden />
              )}
              {retryableUpdateError ? 'Retry' : 'Check for updates'}
            </Button>
          ) : null}
          {canRestart ? (
            <>
              <Button type="button" onClick={handleRestart} disabled={pendingAction !== undefined}>
                <RotateCcwIcon className="size-4" aria-hidden />
                Restart
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setLaterDismissedVersion(state.targetVersion);
                  notifyInfo('Update postponed. Restart from Settings when ready.');
                }}
                disabled={pendingAction !== undefined}
              >
                Later
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
