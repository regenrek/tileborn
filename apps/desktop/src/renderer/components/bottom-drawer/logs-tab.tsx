import { ScrollTextIcon } from 'lucide-react';

import { DrawerEmptyState } from '@/components/bottom-drawer/drawer-empty-state';
import { DrawerListSkeleton } from '@/components/bottom-drawer/drawer-list-skeleton';
import { VirtualLogList } from '@/components/bottom-drawer/virtual-log-list';
import { useLogs } from '@/hooks/queries';

export function LogsTab() {
  const logsQuery = useLogs();
  const entries = logsQuery.data?.entries ?? [];

  if (logsQuery.isLoading) {
    return <DrawerListSkeleton rows={8} />;
  }

  if (entries.length === 0) {
    return (
      <DrawerEmptyState
        icon={ScrollTextIcon}
        title="No log entries yet"
        description="Application logs stream here as the desktop host writes events."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 py-2">
      <VirtualLogList entries={entries} />
    </div>
  );
}
