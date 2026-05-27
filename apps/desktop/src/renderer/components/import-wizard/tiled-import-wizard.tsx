import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
import type {
  ImportCenterApplyReport,
  TiledImportProfile,
  TiledImportRecommendation,
} from '@tileborne/ipc-contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@tileborne/ui';
import { ImportIcon, XIcon } from 'lucide-react';

import {
  useDetectImportSource,
  useImportAssetPack,
  usePickImportSource,
  useTiledImportApply,
  useTiledImportCancel,
  useTiledImportPlan,
  useTiledImportScan,
} from '@/hooks/mutations';
import { getIpcError } from '@/lib/ipc';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

import { ConfirmStep } from './confirm-step';
import { LicenseStep, licenseRequiresAttribution } from './license-step';
import { MapSelectionStep } from './map-selection-step';
import { MappingReviewStep } from './mapping-review-step';
import { ProfileStep } from './profile-step';
import { ResultStep } from './result-step';
import { ScanStep } from './scan-step';
import { SourceStep } from './source-step';
import type { ImportSourceDetection, TiledImportLicenseDraft } from './types';

type WizardStep =
  | 'source'
  | 'scan'
  | 'profile'
  | 'mapping'
  | 'map'
  | 'license'
  | 'confirm'
  | 'result';
type ImportSourceKind = 'tileborne-pack' | 'tiled-source';

const steps: readonly WizardStep[] = [
  'source',
  'scan',
  'profile',
  'mapping',
  'map',
  'license',
  'confirm',
  'result',
];
const packSteps: readonly WizardStep[] = ['source', 'license', 'confirm', 'result'];

const initialLicense: TiledImportLicenseDraft = { redistributable: false };

const errorMessage = (error: unknown, fallback: string): string =>
  getIpcError(error)?.message ?? (error instanceof Error ? error.message : fallback);

const recommendedProfileForImport = (
  profile: TiledImportRecommendation['recommendedProfile'],
): TiledImportProfile | undefined =>
  profile === 'standard' || profile === 'standard-plus-hints' || profile === 'assistive-infer'
    ? profile
    : undefined;

export function ImportWizard({
  open,
  onOpenChange,
  projectId,
  initialSourcePath,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projectId?: string | undefined;
  readonly initialSourcePath?: string | null | undefined;
}) {
  const navigate = useNavigate();
  const detectImportSource = useDetectImportSource();
  const pickImportSource = usePickImportSource();
  const importPack = useImportAssetPack();
  const scanMutation = useTiledImportScan();
  const planMutation = useTiledImportPlan();
  const applyMutation = useTiledImportApply();
  const cancelMutation = useTiledImportCancel();
  const setPendingImportJobId = useEditorUiStore((s) => s.setPendingImportJobId);
  const [step, setStep] = useState<WizardStep>('source');
  const [sourcePath, setSourcePath] = useState('');
  const [detection, setDetection] = useState<ImportSourceDetection | undefined>(undefined);
  const [sourceKind, setSourceKind] = useState<ImportSourceKind>('tiled-source');
  const [profile, setProfile] = useState<TiledImportProfile>('standard');
  const [acceptedSuggestionIds, setAcceptedSuggestionIds] = useState<readonly string[]>([]);
  const [license, setLicense] = useState<TiledImportLicenseDraft>(initialLicense);
  const [scanResponse, setScanResponse] = useState<typeof scanMutation.data | undefined>(undefined);
  const [planResponse, setPlanResponse] = useState<typeof planMutation.data | undefined>(undefined);
  const [applyReport, setApplyReport] = useState<ImportCenterApplyReport | undefined>(undefined);
  const [result, setResult] = useState<
    | {
        readonly kind: 'map' | 'asset-pack' | 'tileborne-pack';
        readonly mapId?: string;
        readonly packId?: string;
        readonly jobId?: string;
      }
    | undefined
  >();

  const resetWizard = () => {
    setStep('source');
    setSourcePath('');
    setDetection(undefined);
    setSourceKind('tiled-source');
    setProfile('standard');
    setAcceptedSuggestionIds([]);
    setLicense(initialLicense);
    setScanResponse(undefined);
    setPlanResponse(undefined);
    setApplyReport(undefined);
    setResult(undefined);
    detectImportSource.reset();
    pickImportSource.reset();
    importPack.reset();
    scanMutation.reset();
    planMutation.reset();
    applyMutation.reset();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetWizard();
    }
    onOpenChange(nextOpen);
  };

  useEffect(() => {
    if (!open || initialSourcePath === undefined || initialSourcePath === null) {
      return;
    }
    const nextSourcePath = initialSourcePath.trim();
    if (nextSourcePath.length === 0 || nextSourcePath === sourcePath) {
      return;
    }
    setSourcePath(nextSourcePath);
    setDetection(undefined);
    setSourceKind('tiled-source');
    setProfile('standard');
    setAcceptedSuggestionIds([]);
    setLicense(initialLicense);
    setScanResponse(undefined);
    setPlanResponse(undefined);
    setApplyReport(undefined);
    setResult(undefined);
    detectImportSource.reset();
    scanMutation.reset();
    planMutation.reset();
    applyMutation.reset();
  }, [
    applyMutation,
    detectImportSource,
    initialSourcePath,
    open,
    planMutation,
    scanMutation,
    sourcePath,
  ]);

  const scanData = scanResponse ?? scanMutation.data;
  const planData = planResponse ?? planMutation.data;
  const scan = scanData?.scan;
  const plan = planData?.plan;
  const activeSteps = sourceKind === 'tileborne-pack' ? packSteps : steps;
  const currentIndex = activeSteps.indexOf(step);
  const pending =
    detectImportSource.isPending ||
    pickImportSource.isPending ||
    importPack.isPending ||
    scanMutation.isPending ||
    planMutation.isPending ||
    applyMutation.isPending;
  const attributionMissing =
    step === 'license' &&
    licenseRequiresAttribution(license.id) &&
    (license.attribution?.trim().length ?? 0) === 0;
  const canContinue =
    projectId !== undefined && sourcePath.trim().length > 0 && !pending && !attributionMissing;
  const currentDetection = detection?.path === sourcePath.trim() ? detection : undefined;

  const progressLabel = useMemo(
    () => `${Math.max(currentIndex, 0) + 1} of ${activeSteps.length}`,
    [activeSteps.length, currentIndex],
  );

  const runScan = async (nextSourcePath = sourcePath) => {
    if (!projectId || nextSourcePath.trim().length === 0) return;
    try {
      const response = await scanMutation.mutateAsync({
        projectId: projectId as ProjectId,
        sourcePath: nextSourcePath.trim(),
      });
      const recommendedProfile = recommendedProfileForImport(
        response.scan.importRecommendation.recommendedProfile,
      );
      if (recommendedProfile !== undefined) {
        setProfile(recommendedProfile);
        setAcceptedSuggestionIds([]);
      }
      setScanResponse(response);
      setPlanResponse(undefined);
      setApplyReport(undefined);
      setStep('scan');
    } catch (error) {
      notifyError(errorMessage(error, 'Tiled scan failed'));
    }
  };

  const runPlan = async (
    nextProfile = profile,
    nextAcceptedIds = acceptedSuggestionIds,
  ): Promise<boolean> => {
    if (!projectId || scan === undefined) return false;
    try {
      const response = await planMutation.mutateAsync({
        projectId: projectId as ProjectId,
        sourcePath: sourcePath.trim(),
        profile: nextProfile,
        hints: { acceptedSuggestionIds: [...nextAcceptedIds] },
      });
      setPlanResponse(response);
      setApplyReport(undefined);
      return true;
    } catch (error) {
      notifyError(errorMessage(error, 'Tiled plan failed'));
      return false;
    }
  };

  const runApply = async () => {
    if (!projectId) return;
    try {
      if (sourceKind === 'tileborne-pack') {
        const response = await importPack.mutateAsync({ path: sourcePath.trim() });
        setPendingImportJobId(response.jobId);
        setResult({ kind: 'tileborne-pack', jobId: response.jobId });
        setStep('result');
        notifySuccess('Asset pack import started.');
        return;
      }
      const response = await applyMutation.mutateAsync({
        projectId: projectId as ProjectId,
        sourcePath: sourcePath.trim(),
        profile,
        hints: { acceptedSuggestionIds: [...acceptedSuggestionIds] },
        license,
      });
      setApplyReport(response.report);
      setResult(
        response.kind === 'map'
          ? {
              kind: 'map',
              mapId: response.mapId,
              ...(response.packId === undefined ? {} : { packId: response.packId }),
            }
          : { kind: 'asset-pack', packId: response.packId },
      );
      setStep('result');
      notifySuccess(response.kind === 'map' ? 'Tiled map imported.' : 'Tiled asset pack imported.');
    } catch (error) {
      notifyError(errorMessage(error, 'Tiled import failed'));
    }
  };

  const routeDetectedSource = async (
    detected: ImportSourceDetection,
    options: { readonly confirmAmbiguous: boolean },
  ) => {
    if (detected.kind === 'zip' || detected.kind === 'unsupported') {
      return;
    }
    if (detected.kind === 'ambiguous' && !options.confirmAmbiguous) {
      return;
    }
    const nextKind =
      detected.preferredKind ??
      (detected.kind === 'tileborne-pack' ? 'tileborne-pack' : 'tiled-source');
    setSourceKind(nextKind);
    setScanResponse(undefined);
    setPlanResponse(undefined);
    setApplyReport(undefined);
    if (nextKind === 'tileborne-pack') {
      setStep('license');
      return;
    }
    await runScan(detected.path);
  };

  const handleNext = async () => {
    if (step === 'source') {
      if (currentDetection !== undefined && currentDetection.kind === 'ambiguous') {
        await routeDetectedSource(currentDetection, { confirmAmbiguous: true });
        return;
      }
      try {
        const response = await detectImportSource.mutateAsync({ path: sourcePath.trim() });
        const detected = response.detection;
        setSourcePath(detected.path);
        setDetection(detected);
        await routeDetectedSource(detected, { confirmAmbiguous: false });
      } catch (error) {
        notifyError(errorMessage(error, 'Import source detection failed'));
      }
      return;
    }
    if (step === 'scan') {
      setStep('profile');
      return;
    }
    if (step === 'profile') {
      if (await runPlan()) {
        setStep('mapping');
      }
      return;
    }
    if (step === 'mapping') {
      if (await runPlan(profile, acceptedSuggestionIds)) {
        setStep('map');
      }
      return;
    }
    if (step === 'map') {
      setStep('license');
      return;
    }
    if (step === 'license') {
      setStep('confirm');
      return;
    }
    if (step === 'confirm') {
      await runApply();
    }
  };

  const handleCancel = () => {
    if (sourceKind === 'tiled-source' && projectId && sourcePath.trim().length > 0) {
      cancelMutation.mutate({ projectId: projectId as ProjectId, sourcePath: sourcePath.trim() });
    }
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,720px)] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle>Import Center</DialogTitle>
          <DialogDescription>
            Step {progressLabel}: analyze, review, and apply Tileborne or Tiled source content.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="grid gap-4 px-6 py-4">
            {step === 'source' ? (
              <SourceStep
                sourcePath={sourcePath}
                pending={pending}
                detection={currentDetection}
                onSourcePathChange={(next) => {
                  setSourcePath(next);
                  setDetection(undefined);
                }}
                onPick={() => {
                  void pickImportSource.mutateAsync().then((picked) => {
                    if (picked.path) {
                      setSourcePath(picked.path);
                      setDetection(undefined);
                    }
                  });
                }}
              />
            ) : null}
            {step === 'scan' ? (
              <ScanStep
                scan={scan}
                diagnostics={scanData?.diagnostics}
                inventoryPreview={scanData?.inventoryPreview}
                recommendation={scan?.importRecommendation}
                pending={scanMutation.isPending}
              />
            ) : null}
            {step === 'profile' ? (
              <ProfileStep
                profile={profile}
                recommendation={scan?.importRecommendation}
                onProfileChange={(next) => {
                  setProfile(next);
                  setAcceptedSuggestionIds([]);
                }}
              />
            ) : null}
            {step === 'mapping' ? (
              <MappingReviewStep
                scan={scan}
                plan={plan}
                acceptedSuggestionIds={acceptedSuggestionIds}
                onAcceptedSuggestionIdsChange={setAcceptedSuggestionIds}
              />
            ) : null}
            {step === 'map' ? <MapSelectionStep plan={plan} /> : null}
            {step === 'license' ? (
              <LicenseStep license={license} onLicenseChange={setLicense} />
            ) : null}
            {step === 'confirm' ? (
              <ConfirmStep scan={scan} plan={plan} license={license} sourceKind={sourceKind} />
            ) : null}
            {step === 'result' ? (
              <ResultStep
                mapId={result?.mapId}
                packId={result?.packId}
                jobId={result?.jobId}
                report={applyReport}
                sourceKind={sourceKind}
                resultKind={result?.kind}
                onOpenMap={() => {
                  if (projectId && result?.mapId) {
                    void navigate({
                      to: '/projects/$projectId/maps/$mapId',
                      params: { projectId, mapId: result.mapId },
                    });
                  }
                  handleOpenChange(false);
                }}
                onClose={() => handleOpenChange(false)}
              />
            ) : null}
          </div>
        </div>
        {step !== 'result' ? (
          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="outline" disabled={pending} onClick={handleCancel}>
              <XIcon data-icon="inline-start" />
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canContinue}
              data-testid="tiled-import-next"
              onClick={() => void handleNext()}
            >
              {step === 'scan' ? 'Use recommendation' : step === 'confirm' ? 'Import' : 'Continue'}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ImportWizardTrigger({ projectId }: { readonly projectId?: string | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={projectId === undefined}
        data-testid="import-wizard-trigger"
        onClick={() => setOpen(true)}
      >
        <ImportIcon data-icon="inline-start" />
        Import
      </Button>
      {open ? <ImportWizard open={open} onOpenChange={setOpen} projectId={projectId} /> : null}
    </>
  );
}
