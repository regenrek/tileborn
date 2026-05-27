import { useQuery } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@tileborne/ui';
import type { PackCapabilityDiagnostic, PackId } from '@tileborne/core';
import type { JobId } from '@tileborne/services-foundation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRemoveAssetPack } from '@/hooks/mutations';
import { invokeIpc } from '@/lib/ipc';
import { queryKeys } from '@/lib/query-client';
import { notifyError } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface DuplicateInfo {
  readonly existingPackId: string;
  readonly newPackId: string;
  readonly integrityHashesMatch: boolean;
  readonly newPackName: string;
}

const isDuplicateDiagnostic = (
  diagnostic: PackCapabilityDiagnostic,
): diagnostic is Extract<PackCapabilityDiagnostic, { readonly _tag: 'PACK.duplicate-id' }> =>
  diagnostic._tag === 'PACK.duplicate-id';

export function DuplicatePackDialog() {
  const pendingImportJobId = useEditorUiStore((s) => s.pendingImportJobId);
  const setPendingImportJobId = useEditorUiStore((s) => s.setPendingImportJobId);
  const removePack = useRemoveAssetPack();
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const resolvedJobIdRef = useRef<string | null>(null);
  const clearResolvedImportJob = useCallback(() => {
    if (pendingImportJobId !== null) {
      resolvedJobIdRef.current = pendingImportJobId;
    }
    setPendingImportJobId(null);
  }, [pendingImportJobId, setPendingImportJobId]);

  const jobQuery = useQuery({
    queryKey: [...queryKeys.jobs.all, 'import-followup', pendingImportJobId ?? 'idle'],
    queryFn: () =>
      invokeIpc(() =>
        window.tileborne.jobs.get({ jobId: pendingImportJobId! as JobId }),
      ),
    enabled: pendingImportJobId !== null && resolvedJobIdRef.current !== pendingImportJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) {
        return 250;
      }
      const status = data.job.status;
      if (status === 'Completed' || status === 'Failed' || status === 'Cancelled') {
        return false;
      }
      return 250;
    },
  });

  useEffect(() => {
    if (pendingImportJobId === null) {
      return;
    }
    if (resolvedJobIdRef.current === pendingImportJobId) {
      return;
    }
    const data = jobQuery.data;
    if (!data) {
      return;
    }
    const status = data.job.status;
    if (status !== 'Completed') {
      if (status === 'Failed') {
        notifyError(data.job.errorMessage ?? 'Asset pack import failed.');
        clearResolvedImportJob();
      } else if (status === 'Cancelled') {
        notifyError('Asset pack import cancelled.');
        clearResolvedImportJob();
      }
      return;
    }
    const result = data.job.result as { readonly packId?: string } | undefined;
    const newPackId = result?.packId;
    if (!newPackId) {
      clearResolvedImportJob();
      return;
    }
    resolvedJobIdRef.current = pendingImportJobId;
    let cancelled = false;
    void invokeIpc(() =>
      window.tileborne.assets.getPack({ packId: newPackId as PackId }),
    )
      .then((response) => {
        if (cancelled) return;
        const pack = response.pack;
        const dup = pack.capability.diagnostics.find(isDuplicateDiagnostic);
        if (!dup) {
          clearResolvedImportJob();
          return;
        }
        setDuplicate({
          existingPackId: dup.existingPackId ?? newPackId,
          newPackId: dup.newPackId ?? newPackId,
          integrityHashesMatch: dup.integrityHashesMatch === true,
          newPackName: pack.name,
        });
      })
      .catch(() => {
        if (cancelled) return;
        clearResolvedImportJob();
      });
    return () => {
      cancelled = true;
    };
  }, [clearResolvedImportJob, jobQuery.data, pendingImportJobId]);

  const handleKeepBoth = () => {
    setDuplicate(null);
    setPendingImportJobId(null);
  };

  const handleReplace = async () => {
    if (!duplicate) return;
    try {
      await removePack.mutateAsync(duplicate.existingPackId);
    } finally {
      setDuplicate(null);
      setPendingImportJobId(null);
    }
  };

  const open = duplicate !== null;
  const integrityHint = duplicate?.integrityHashesMatch
    ? ' (identical contents)'
    : '';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !removePack.isPending) {
          handleKeepBoth();
        }
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="duplicate-pack-dialog">
        <DialogHeader>
          <DialogTitle>Pack id already installed</DialogTitle>
          <DialogDescription>
            A pack with id <code>{duplicate?.newPackId}</code> is already installed
            {integrityHint}. Replace the existing pack or keep both?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleReplace}
            disabled={removePack.isPending}
            data-testid="duplicate-pack-replace"
          >
            Replace
          </Button>
          <Button
            type="button"
            onClick={handleKeepBoth}
            disabled={removePack.isPending}
            data-testid="duplicate-pack-keep-both"
          >
            Keep both
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
