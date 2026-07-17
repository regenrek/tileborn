import { useEffect } from 'react';
import { Button, elevation, statusSurface } from '@tileborne/ui';
import { XIcon } from 'lucide-react';

import {
  useAppNotificationsStore,
  type AppNotificationKind,
} from '@/stores/app-notifications-store';

const AUTO_DISMISS_MS = 5_000;

const kindStyles: Record<AppNotificationKind, string> = {
  success: statusSurface.success,
  error: statusSurface.error,
  info: statusSurface.info,
};

function NotificationItem({
  id,
  kind,
  message,
}: {
  readonly id: string;
  readonly kind: AppNotificationKind;
  readonly message: string;
}) {
  const dismiss = useAppNotificationsStore((state) => state.dismiss);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [dismiss, id]);

  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${elevation.md} ${kindStyles[kind]}`}
    >
      <p className="min-w-0 flex-1">{message}</p>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss notification"
        onClick={() => dismiss(id)}
      >
        <XIcon />
      </Button>
    </div>
  );
}

export function AppNotifications() {
  const notifications = useAppNotificationsStore((state) => state.notifications);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {notifications.map((notification) => (
        <div key={notification.id} className="pointer-events-auto">
          <NotificationItem {...notification} />
        </div>
      ))}
    </div>
  );
}
