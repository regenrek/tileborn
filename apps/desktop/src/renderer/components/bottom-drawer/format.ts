import { useEffect, useState } from 'react';

const firstSeenAt = new Map<string, number>();
const drawerTimestampFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function useJobFirstSeen(jobIds: readonly string[]): Readonly<Record<string, number>> {
  const [snapshot, setSnapshot] = useState<Record<string, number>>({});

  useEffect(() => {
    const now = Date.now();
    for (const jobId of jobIds) {
      if (!firstSeenAt.has(jobId)) {
        firstSeenAt.set(jobId, now);
      }
    }
    setSnapshot(Object.fromEntries(jobIds.map((jobId) => [jobId, firstSeenAt.get(jobId) ?? now])));
  }, [jobIds]);

  return snapshot;
}

export function formatDrawerTimestamp(epochMs: number): string {
  return drawerTimestampFormat.format(new Date(epochMs));
}

export function formatLogTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return iso;
  }
  return formatDrawerTimestamp(parsed);
}
