import { create } from 'zustand';

export type AppNotificationKind = 'success' | 'error' | 'info';

export interface AppNotification {
  readonly id: string;
  readonly kind: AppNotificationKind;
  readonly message: string;
}

interface AppNotificationsState {
  readonly notifications: readonly AppNotification[];
  push: (notification: Omit<AppNotification, 'id'>) => void;
  dismiss: (id: string) => void;
}

let notificationCounter = 0;

const nextNotificationId = (): string => {
  notificationCounter += 1;
  return `notification-${notificationCounter}`;
};

export const useAppNotificationsStore = create<AppNotificationsState>((set) => ({
  notifications: [],
  push: (notification) =>
    set((state) => ({
      notifications: [...state.notifications, { ...notification, id: nextNotificationId() }],
    })),
  dismiss: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((entry) => entry.id !== id),
    })),
}));

export const notifySuccess = (message: string): void => {
  useAppNotificationsStore.getState().push({ kind: 'success', message });
};

export const notifyError = (message: string): void => {
  useAppNotificationsStore.getState().push({ kind: 'error', message });
};

export const notifyInfo = (message: string): void => {
  useAppNotificationsStore.getState().push({ kind: 'info', message });
};
