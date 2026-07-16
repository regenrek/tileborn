import type { ReadinessDiagnostic, ReadinessReport } from '@tileborne/ipc-contracts';

export interface CreatorReadinessStep {
  readonly id: string;
  readonly label: string;
  readonly status: 'complete' | 'warning' | 'blocked';
  readonly diagnostics: readonly ReadinessDiagnostic[];
}

const statusFor = (diagnostics: readonly ReadinessDiagnostic[]) =>
  diagnostics.some((entry) => entry.severity === 'error')
    ? 'blocked' as const
    : diagnostics.some((entry) => entry.severity === 'warning')
      ? 'warning' as const
      : 'complete' as const;

export const buildCreatorReadinessChecklist = (
  report: ReadinessReport,
  modeFacts: readonly {
    readonly id: string;
    readonly label: string;
    readonly sources: readonly ReadinessDiagnostic['source'][];
  }[] = [],
): readonly CreatorReadinessStep[] => {
  const step = (
    id: CreatorReadinessStep['id'],
    label: string,
    sources: readonly ReadinessDiagnostic['source'][],
  ): CreatorReadinessStep => {
    const diagnostics = report.diagnostics.filter(
      (entry) => sources.includes(entry.source) && entry.severity !== 'info',
    );
    return { id, label, status: statusFor(diagnostics), diagnostics };
  };
  const coreSteps = [
    step('mode', 'Choose and configure a game mode', ['game-mode']),
    step('world', 'Create a valid playable map', ['map']),
    step('gameplay', 'Resolve gameplay catalog references', ['catalog']),
    step('visuals', 'Prepare assets and player visuals', ['asset', 'visual-model']),
  ];
  const factSteps = modeFacts.map((fact) =>
    step(`mode-fact:${fact.id}`, fact.label, fact.sources),
  );
  return [
    ...coreSteps,
    ...factSteps,
    {
      id: 'ready',
      label: 'Playtest and build',
      status: report.ok ? 'complete' : 'blocked',
      diagnostics: report.diagnostics.filter((entry) => entry.severity === 'error'),
    },
  ];
};
