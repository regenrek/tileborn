import {
  Badge,
  Button,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  cn,
  typography,
} from '@tileborne/ui';
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleSlashIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { useMap, useResolvedCatalog, useValidateCatalog } from '@/hooks/queries';
import {
  groupValidationIssues,
  resolveValidationNavigation,
  type ValidationNavigationTarget,
} from '@/lib/catalog-validation';
import type { CatalogValidationIssue } from '@tileborne/ipc-contracts';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface CatalogValidationDrawerProps {
  readonly projectId: string | null | undefined;
  /** Open map, used to navigate an issue to a placed object of its type. */
  readonly mapId?: string | null | undefined;
}

/** Best-effort hint describing where clicking an issue will navigate. */
const navigationHint = (target: ValidationNavigationTarget): string | undefined => {
  switch (target.kind) {
    case 'object':
      return 'Select placed object';
    case 'palette':
      return 'Show type in palette';
    case 'none':
      return undefined;
  }
};

/**
 * Navigable catalog validation-report drawer (ADR-0025 slice 8 — the P0 seed of
 * the P1 diagnostics surface). Runs `tileborne:catalog:validate` via
 * {@link useValidateCatalog}, surfaces a status badge that reflects `report.ok`
 * (green when clean, an issue count otherwise), and opens a drawer listing the
 * `CatalogValidationIssue`s grouped by `kind`.
 *
 * Each issue that references an object type is click-navigable (best-effort):
 * it selects a placed `MapObject` of that type when one exists, otherwise it
 * surfaces the type as the active catalog-object brush in the palette. The
 * report refreshes via the same invalidation as `catalog:resolve` (import
 * success + plugin changes). Stays plugin-neutral: consumes only the projected
 * `catalog:*` / map DTOs and the editor UI store — never `services-plugin`.
 */
export function CatalogValidationDrawer({ projectId, mapId }: CatalogValidationDrawerProps) {
  const [open, setOpen] = useState(false);
  const hasProject = projectId !== null && projectId !== undefined && projectId.length > 0;

  const validateQuery = useValidateCatalog(hasProject ? projectId : undefined);
  const mapQuery = useMap(hasProject ? projectId : undefined, mapId ?? undefined);
  const catalogQuery = useResolvedCatalog(hasProject ? projectId : undefined);

  const setSelection = useEditorUiStore((state) => state.setSelection);
  const selectTool = useEditorUiStore((state) => state.selectTool);
  const selectBrush = useEditorUiStore((state) => state.selectBrush);

  const report = validateQuery.data?.report;
  const map = mapQuery.data?.map;
  const issues = report?.issues ?? [];
  const groups = useMemo(() => groupValidationIssues(issues), [issues]);

  const labelByTypeId = useMemo(() => {
    const byId = new Map<string, string>();
    for (const entry of catalogQuery.data?.objectTypes ?? []) {
      byId.set(entry.objectType.id, entry.objectType.label);
    }
    return byId;
  }, [catalogQuery.data?.objectTypes]);

  const navigate = (issue: CatalogValidationIssue) => {
    const target = resolveValidationNavigation(issue, map);
    switch (target.kind) {
      case 'object':
        setSelection(new Set([target.objectId]));
        selectTool('select');
        setOpen(false);
        break;
      case 'palette':
        selectBrush(
          {
            kind: 'plugin-object',
            objectKind: target.objectTypeId,
            label: labelByTypeId.get(target.objectTypeId) ?? target.objectTypeId,
          },
          'objectPlace',
        );
        setOpen(false);
        break;
      case 'none':
        break;
    }
  };

  return (
    <div className="flex flex-col gap-1.5 px-1" data-testid="catalog-validation">
      <ValidationTrigger
        report={report}
        isLoading={validateQuery.isLoading}
        isError={validateQuery.isError}
        disabled={!hasProject}
        onOpen={() => setOpen(true)}
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-96 sm:max-w-md"
          data-testid="catalog-validation-drawer"
        >
          <SheetHeader>
            <SheetTitle>Catalog validation</SheetTitle>
            <SheetDescription>
              {report === undefined
                ? 'Validating the project catalog merged with plugin catalogs.'
                : report.ok
                  ? 'No issues found in the merged catalog.'
                  : `${issues.length} issue${issues.length === 1 ? '' : 's'} found. Click an issue to jump to the related object type.`}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1 px-6 pb-6">
            {report === undefined ? (
              <div className="space-y-2" data-testid="catalog-validation-loading">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : report.ok ? (
              <div
                className="flex items-center gap-2 rounded-md border border-border bg-card p-3"
                data-testid="catalog-validation-clean"
              >
                <CheckCircle2Icon className="size-4 text-success" aria-hidden />
                <p className={cn(typography.bodyDense)}>The catalog is valid.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {groups.map((group) => (
                  <section
                    key={group.kind}
                    className="flex flex-col gap-1"
                    data-testid={`catalog-validation-group-${group.kind}`}
                  >
                    <p className={cn('px-0.5', typography.sectionLabelMicro)}>
                      {group.label} ({group.issues.length})
                    </p>
                    <ul className="flex flex-col gap-1">
                      {group.issues.map((issue, index) => (
                        <ValidationIssueRow
                          key={`${group.kind}-${issue.objectTypeId ?? issue.missingId ?? index}`}
                          issue={issue}
                          target={resolveValidationNavigation(issue, map)}
                          typeLabel={
                            issue.objectTypeId === undefined
                              ? undefined
                              : labelByTypeId.get(issue.objectTypeId)
                          }
                          onNavigate={() => navigate(issue)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ValidationTrigger({
  report,
  isLoading,
  isError,
  disabled,
  onOpen,
}: {
  readonly report: { readonly ok: boolean; readonly issues: readonly unknown[] } | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly disabled: boolean;
  readonly onOpen: () => void;
}) {
  const issueCount = report?.issues.length ?? 0;
  const clean = report?.ok === true;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 justify-start gap-2 px-2"
      data-testid="catalog-validation-trigger"
      data-state={clean ? 'ok' : report !== undefined ? 'issues' : 'unknown'}
      disabled={disabled}
      onClick={onOpen}
    >
      {isLoading ? (
        <CircleSlashIcon className="size-3 text-muted-foreground" aria-hidden />
      ) : clean ? (
        <CheckCircle2Icon className="size-3 text-success" aria-hidden />
      ) : (
        <TriangleAlertIcon
          className={cn(
            'size-3',
            isError || report !== undefined ? 'text-destructive' : 'text-muted-foreground',
          )}
          aria-hidden
        />
      )}
      <span className="flex-1 text-left">Validation</span>
      {report === undefined ? null : clean ? (
        <Badge
          variant="success"
          className={cn('px-1.5 py-0 font-normal', typography.rowMeta)}
          data-testid="catalog-validation-badge-ok"
        >
          OK
        </Badge>
      ) : (
        <Badge
          variant="destructive"
          className={cn('px-1.5 py-0 font-normal', typography.rowMeta)}
          data-testid="catalog-validation-badge-count"
        >
          {issueCount}
        </Badge>
      )}
    </Button>
  );
}

function ValidationIssueRow({
  issue,
  target,
  typeLabel,
  onNavigate,
}: {
  readonly issue: CatalogValidationIssue;
  readonly target: ValidationNavigationTarget;
  readonly typeLabel: string | undefined;
  readonly onNavigate: () => void;
}) {
  const hint = navigationHint(target);
  const navigable = target.kind !== 'none';

  const body = (
    <>
      <span className={cn('min-w-0 flex-1 break-words text-left', typography.bodyMicro)}>
        {typeLabel !== undefined ? (
          <span className="mr-1 font-medium text-foreground">{typeLabel}:</span>
        ) : null}
        {issue.message}
        {hint !== undefined ? (
          <span className="mt-0.5 block text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      {navigable ? (
        <ChevronRightIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </>
  );

  return (
    <li data-testid="catalog-validation-issue" data-issue-kind={issue.kind}>
      {navigable ? (
        <button
          type="button"
          data-testid="catalog-validation-issue-button"
          className="flex w-full items-start gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left transition-colors hover:border-primary/70 hover:bg-accent/20"
          onClick={onNavigate}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-border bg-card px-2 py-1.5">
          {body}
        </div>
      )}
    </li>
  );
}
