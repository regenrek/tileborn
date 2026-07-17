import type { ReadinessReport } from '@tileborne/ipc-contracts';

export type RendererExecutionEntryPoint =
  | 'topbar.playtest.single'
  | 'topbar.playtest.host'
  | 'topbar.build'
  | 'command-palette.playtest'
  | 'command-palette.build';

export const rendererExecutionAction = (
  entryPoint: RendererExecutionEntryPoint,
): 'playtest' | 'build' => (entryPoint.includes('build') ? 'build' : 'playtest');

export const READINESS_PROBLEMS_EVENT = 'tileborne:readiness-show-problems';

export const blockingReadinessDiagnostics = (report: ReadinessReport | undefined) =>
  report?.diagnostics.filter((diagnostic) => diagnostic.severity === 'error') ?? [];

export const readinessWarnings = (report: ReadinessReport | undefined) =>
  report?.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning') ?? [];

export const readinessGateMessage = (
  report: ReadinessReport | undefined,
  action: 'playtest' | 'build',
): string => {
  if (report === undefined) {
    return `Readiness is still being checked before ${action}.`;
  }
  const errors = blockingReadinessDiagnostics(report);
  if (errors.length === 0) {
    return '';
  }
  return `Fix ${errors.length} readiness error${errors.length === 1 ? '' : 's'} before ${action}.`;
};

export const showReadinessProblems = (): void => {
  window.dispatchEvent(new CustomEvent(READINESS_PROBLEMS_EVENT));
};
