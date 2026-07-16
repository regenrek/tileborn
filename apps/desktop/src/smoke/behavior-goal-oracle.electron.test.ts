import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalGameHost } from '@tileborne/game-host/local';
import { expect } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  closeSmokeApp,
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  resolveMainEntry,
  waitForJob,
  type SmokeContext,
} from './helpers.js';

const VISUAL_NODE = 'behavior-node:00000000-0000-4000-8000-000000000801';
const MISSING_NODE = 'behavior-node:00000000-0000-4000-8000-000000000802';
const MISSING_BEHAVIOR = 'behavior:00000000-0000-4000-8000-000000000899';
const ORACLE_RUN_ID = process.env.TILEBORNE_CREATOR_ORACLE_RUN_ID ?? `local-${Date.now()}`;
const ORACLE_ARTIFACTS = process.env.TILEBORNE_CREATOR_ORACLE_ARTIFACTS;

const artifactPath = (name: string): string | undefined =>
  ORACLE_ARTIFACTS === undefined ? undefined : path.join(ORACLE_ARTIFACTS, name);

const startTrace = async (smokeContext: SmokeContext): Promise<void> => {
  if (ORACLE_ARTIFACTS === undefined) return;
  await smokeContext.page.context().tracing.start({ screenshots: true, snapshots: true });
};

const stopTrace = async (smokeContext: SmokeContext, name: string): Promise<void> => {
  const target = artifactPath(name);
  if (target === undefined) return;
  await smokeContext.page.context().tracing.stop({ path: target });
};

const capture = async (smokeContext: SmokeContext, name: string): Promise<void> => {
  const target = artifactPath(name);
  if (target === undefined) return;
  await smokeContext.page.screenshot({ path: target, fullPage: true });
};

const nativeSource = (id: string, body: string) => `
import { defineBehavior } from '@tileborne/game-sdk';
export default defineBehavior({
  id: ${JSON.stringify(id)},
  state: { proof: false },
  on: {
    'runtime.tick': ({ state }) => ${body},
  },
});
`;

describe('live behavior Goal Oracle (fresh-profile Electron)', () => {
  let context: SmokeContext | undefined;
  const isolatedArtifacts: string[] = [];

  beforeAll(async () => {
    resolveMainEntry();
    if (ORACLE_ARTIFACTS !== undefined) {
      await mkdir(ORACLE_ARTIFACTS, { recursive: true });
    }
    context = await launchElectron(await createTileborneHome());
    await startTrace(context);
  }, 120_000);

  afterAll(async () => {
    await disposeSmokeContext(context);
    context = undefined;
    await Promise.all(
      isolatedArtifacts.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('authors equivalent visual and TypeScript behavior, debugs it, reopens it, and boots the shipped copy', async () => {
    let { page } = context!;
    const { tileborneHome } = context!;
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            try {
              await window.tileborne.projects.list({});
              return true;
            } catch {
              return false;
            }
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
    const projectName = `Creator Release Oracle ${ORACLE_RUN_ID}`;
    await navigateToRoute(page, '/');
    await page
      .getByRole('button', { name: /New game/i })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: /New game/i })).toBeVisible();
    await expect(page.getByTestId('new-game-type-battle-royale')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByLabel('Project name').fill(projectName);
    await page.getByLabel('Project name').press('Enter');
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 30_000 });
    const created = await page.evaluate(async (name) => {
      const { projects } = await window.tileborne.projects.list({});
      const summary = projects.find((project) => project.name === name);
      if (summary === undefined) throw new Error(`UI-created project missing: ${name}`);
      const { project } = await window.tileborne.projects.get({ projectId: summary.id });
      const map = project.maps[0];
      if (map === undefined) throw new Error('UI-created BR starter has no map');
      return { projectId: String(project.id), mapId: String(map.id) };
    }, projectName);

    const authored = await page.evaluate(
      async ({ projectId, visualNode, missingNode, missingBehavior }) => {
        const visualDraft = (value: unknown, nodeId: string) => ({
          state: [{ key: 'proof', label: 'Proof', initialValue: false }],
          when: { entryId: 'runtime.tick', arguments: {} },
          do: [
            {
              _tag: 'action' as const,
              nodeId,
              invocation: {
                entryId: 'state.set',
                arguments: {
                  key: { _tag: 'literal' as const, value: 'proof' },
                  value,
                },
              },
            },
          ],
        });
        const createVisual = async (label: string, definition: ReturnType<typeof visualDraft>) => {
          const before = await window.tileborne.behaviors.open({ projectId });
          const beforeIds = new Set(
            before.snapshot.resources.map(({ manifest }) => String(manifest.id)),
          );
          const result = await window.tileborne.behaviors.createVisual({
            projectId,
            label,
            definition,
            requiredCapabilities: ['time.deterministic', 'state.core'],
          });
          const resource = result.snapshot.resources.find(
            ({ manifest }) => !beforeIds.has(String(manifest.id)),
          );
          if (resource === undefined)
            throw new Error(`Could not identify created behavior ${label}`);
          return { resource, snapshot: result.snapshot };
        };

        const visual = await createVisual(
          'Visual Tick Proof',
          visualDraft({ _tag: 'literal', value: true }, visualNode),
        );
        const nativeSeed = await createVisual(
          'Native Tick Proof',
          visualDraft({ _tag: 'literal', value: true }, `${visualNode.slice(0, -1)}2`),
        );
        const converted = await window.tileborne.behaviors.convertToTypeScript({
          projectId,
          behaviorId: nativeSeed.resource.manifest.id,
          expectedRevision: nativeSeed.snapshot.revision,
        });
        const nativeResource = converted.snapshot.resources.find(
          ({ manifest }) => manifest.id === nativeSeed.resource.manifest.id,
        );
        if (nativeResource?.kind !== 'typescript')
          throw new Error('Native proof conversion failed');
        const nativeSaved = await window.tileborne.behaviors.saveTypeScript({
          projectId,
          behaviorId: nativeResource.manifest.id,
          expectedRevision: converted.snapshot.revision,
          label: 'Native Tick Proof',
          source: `
import { defineBehavior } from '@tileborne/game-sdk';
export default defineBehavior({
  id: 'goal-oracle.native-proof',
  state: { proof: false },
  on: { 'runtime.tick': ({ state }) => state.set('proof', true) },
});`,
          exportName: 'default',
          requiredCapabilities: ['time.deterministic', 'state.core'],
        });

        const runawaySeed = await createVisual(
          'Runaway Isolation Proof',
          visualDraft({ _tag: 'literal', value: true }, `${visualNode.slice(0, -1)}3`),
        );
        const runawayConverted = await window.tileborne.behaviors.convertToTypeScript({
          projectId,
          behaviorId: runawaySeed.resource.manifest.id,
          expectedRevision: runawaySeed.snapshot.revision,
        });
        const runawayResource = runawayConverted.snapshot.resources.find(
          ({ manifest }) => manifest.id === runawaySeed.resource.manifest.id,
        );
        if (runawayResource?.kind !== 'typescript')
          throw new Error('Runaway proof conversion failed');
        const runawaySaved = await window.tileborne.behaviors.saveTypeScript({
          projectId,
          behaviorId: runawayResource.manifest.id,
          expectedRevision: runawayConverted.snapshot.revision,
          label: 'Runaway Isolation Proof',
          source: `
import { defineBehavior } from '@tileborne/game-sdk';
export default defineBehavior({
  id: 'goal-oracle.runaway-proof',
  state: { proof: false },
  on: { 'runtime.tick': ({ state }) => state.set('proof', true) },
});`,
          exportName: 'default',
          requiredCapabilities: ['time.deterministic', 'state.core'],
        });

        const missing = await createVisual(
          'Missing Reference Proof',
          visualDraft(
            {
              _tag: 'reference',
              reference: { _tag: 'behavior', behaviorId: missingBehavior },
            },
            missingNode,
          ),
        );
        const broken = await window.tileborne.readiness.check({
          projectId,
          mapId: undefined,
          purpose: 'build',
        });
        const missingDiagnostic = broken.report.diagnostics.find(
          ({ code, behaviorId }) =>
            code === 'behavior.reference-missing' && behaviorId === missing.resource.manifest.id,
        );
        if (missingDiagnostic?.navigation?.kind !== 'behavior') {
          throw new Error(
            `Missing reference was not actionable: ${JSON.stringify(broken.report.diagnostics)}`,
          );
        }
        const missingResource = missing.snapshot.resources.find(
          ({ manifest }) => manifest.id === missing.resource.manifest.id,
        );
        if (missingResource?.kind !== 'visual')
          throw new Error('Missing reference visual resource disappeared');
        const repairedDefinition = {
          ...missingResource.definition,
          do: missingResource.definition.do.map((node) =>
            node.nodeId === missingNode && node._tag === 'action'
              ? {
                  ...node,
                  invocation: {
                    ...node.invocation,
                    arguments: {
                      ...node.invocation.arguments,
                      value: { _tag: 'literal' as const, value: true },
                    },
                  },
                }
              : node,
          ),
        };
        const repaired = await window.tileborne.behaviors.saveVisual({
          projectId,
          behaviorId: missingResource.manifest.id,
          expectedRevision: missing.snapshot.revision,
          label: missingResource.manifest.label,
          definition: repairedDefinition,
          requiredCapabilities: [...missingResource.manifest.requiredCapabilities],
        });
        const ready = await window.tileborne.readiness.check({ projectId, purpose: 'build' });
        if (!ready.report.ok)
          throw new Error(
            `Reference repair did not restore readiness: ${JSON.stringify(ready.report.diagnostics)}`,
          );

        return {
          visualId: String(visual.resource.manifest.id),
          nativeId: String(nativeResource.manifest.id),
          runawayId: String(runawayResource.manifest.id),
          missingId: String(missingResource.manifest.id),
          missingNode: String(missingDiagnostic.behaviorNodeId),
          missingPath: missingDiagnostic.path,
          finalRevision: repaired.snapshot.revision,
          nativeRevision: nativeSaved.snapshot.revision,
          runawayRevision: runawaySaved.snapshot.revision,
        };
      },
      {
        projectId: created.projectId,
        visualNode: VISUAL_NODE,
        missingNode: MISSING_NODE,
        missingBehavior: MISSING_BEHAVIOR,
      },
    );

    await navigateToRoute(page, `/projects/${created.projectId}/game-content`);
    await page.getByTestId('content-tab-items').click();
    await page.getByTestId('content-name').fill('Crash Recovered Oracle Potion');
    await expect(page.getByTestId('content-document-status')).toHaveText('dirty');
    const recoveryDocumentId = `game-content:${created.projectId}`;
    await expect
      .poll(() =>
        page.evaluate(async (documentId) => {
          const { records } = await window.tileborneAppLifecycle.loadRecoveryStorage();
          return (
            records.find((record) => record.documentId === documentId)?.snapshot as
              | { label?: string }
              | undefined
          )?.label;
        }, recoveryDocumentId),
      )
      .toBe('Crash Recovered Oracle Potion');
    await capture(context!, '01-durable-draft-before-interruption.png');
    await stopTrace(context!, '01-authoring-and-durable-draft.zip');

    const interruptedAppClosed = context!.app.waitForEvent('close');
    context!.app.process().kill('SIGKILL');
    await interruptedAppClosed;
    context = await launchElectron(tileborneHome);
    page = context.page;
    await startTrace(context);
    await expect
      .poll(() =>
        page.evaluate(async (documentId) => {
          const { records } = await window.tileborneAppLifecycle.loadRecoveryStorage();
          return records.some((record) => record.documentId === documentId);
        }, recoveryDocumentId),
      )
      .toBe(true);
    await navigateToRoute(page, `/projects/${created.projectId}/game-content`);
    await page.getByTestId('content-tab-items').click();
    await expect(page.getByTestId('content-name')).toHaveValue('Crash Recovered Oracle Potion');
    await expect(page.getByTestId('content-document-status')).toHaveText('dirty');
    await capture(context, '02-recovered-draft-after-interruption.png');
    await page.getByTestId('content-discard-draft').click();
    await expect(page.getByTestId('content-document-status')).toHaveText('clean');
    await expect
      .poll(() =>
        page.evaluate(async (documentId) => {
          const { records } = await window.tileborneAppLifecycle.loadRecoveryStorage();
          return records.every((record) => record.documentId !== documentId);
        }, recoveryDocumentId),
      )
      .toBe(true);

    await navigateToRoute(page, `/projects/${created.projectId}/behaviors`);
    await expect(page.getByTestId('behavior-editor-page')).toBeVisible();
    await expect(page.getByRole('option', { name: /Visual Tick Proof/ })).toBeVisible();
    await page.getByRole('option', { name: /Native Tick Proof/ }).click();
    await expect(page.getByLabel('TypeScript behavior source')).toHaveValue(/runtime\.tick/);

    await navigateToRoute(page, `/projects/${created.projectId}/maps/${created.mapId}`);
    await expect(page.getByTestId('readiness-status')).toContainText(/Ready|warnings/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('playtest-menu-trigger')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('playtest-menu-trigger').click();
    await page.getByTestId('playtest-menu-single').click();
    await expect
      .poll(
        async () =>
          page.evaluate(async (projectId) => {
            const { sessions } = await window.tileborne.playtest.list({});
            const projectSessions = sessions.filter(
              (entry) => String(entry.projectId) === projectId,
            );
            const running = projectSessions.find((entry) => entry.status === 'Running');
            return JSON.stringify(
              running === undefined
                ? {
                    status: 'waiting',
                    observed: projectSessions.map((entry) => ({
                      id: String(entry.id),
                      status: entry.status,
                      errorMessage: entry.errorMessage,
                      runtimeMetrics: entry.runtimeMetrics,
                    })),
                    alerts: [...document.querySelectorAll('[role="alert"]')].map(
                      (element) => element.textContent,
                    ),
                    bodyTail: (document.body.textContent ?? '').slice(-1_000),
                  }
                : { status: 'running', id: String(running.id) },
            );
          }, created.projectId),
        { timeout: 30_000, intervals: [100, 250, 500] },
      )
      .toMatch(/^\{"status":"running","id":".+"\}$/);
    const session = await page.evaluate(async (projectId) => {
      const { sessions } = await window.tileborne.playtest.list({});
      const running = sessions.find(
        (entry) => String(entry.projectId) === projectId && entry.status === 'Running',
      );
      if (running === undefined) throw new Error('UI-started playtest session missing');
      return running;
    }, created.projectId);
    await expect
      .poll(
        async () =>
          page.evaluate(async (sessionId) => {
            try {
              await window.tileborne.playtest.behaviorDebugInspect({ sessionId });
              return true;
            } catch {
              return false;
            }
          }, session.id),
        { timeout: 30_000, intervals: [100, 250, 500] },
      )
      .toBe(true);

    const equivalent = await expect
      .poll(
        async () =>
          page.evaluate(
            async ({ sessionId, visualId, nativeId }) => {
              const { snapshot } = await window.tileborne.playtest.behaviorDebugInspect({
                sessionId,
              });
              const visual = snapshot.traces.find((trace) => String(trace.behaviorId) === visualId);
              const native = snapshot.traces.find((trace) => String(trace.behaviorId) === nativeId);
              return visual !== undefined && native !== undefined
                ? {
                    visualState: visual.state,
                    nativeState: native.state,
                    visualCommands: visual.commands,
                    nativeCommands: native.commands,
                    visualEvent: visual.eventId,
                    nativeEvent: native.eventId,
                  }
                : undefined;
            },
            { sessionId: session.id, visualId: authored.visualId, nativeId: authored.nativeId },
          ),
        {
          timeout: 30_000,
          intervals: [100, 250, 500],
        },
      )
      .toEqual({
        visualState: { proof: true },
        nativeState: { proof: true },
        visualCommands: [{ kind: 'state.set', payload: { key: 'proof', value: true } }],
        nativeCommands: [{ kind: 'state.set', payload: { key: 'proof', value: true } }],
        visualEvent: 'runtime.tick',
        nativeEvent: 'runtime.tick',
      });
    void equivalent;

    const paused = await page.evaluate(
      async (sessionId) =>
        (await window.tileborne.playtest.behaviorDebugControl({ sessionId, command: 'pause' }))
          .snapshot,
      session.id,
    );
    expect(paused.status).toBe('paused');
    const stepped = await page.evaluate(
      async (sessionId) =>
        (await window.tileborne.playtest.behaviorDebugControl({ sessionId, command: 'step' }))
          .snapshot,
      session.id,
    );
    expect(stepped.tick).toBe(paused.tick + 1);
    const continued = await page.evaluate(
      async (sessionId) =>
        (await window.tileborne.playtest.behaviorDebugControl({ sessionId, command: 'continue' }))
          .snapshot,
      session.id,
    );
    expect(continued.status).toBe('running');

    const invalidReload = await page.evaluate(
      async ({ projectId, nativeId }) => {
        const opened = await window.tileborne.behaviors.open({ projectId });
        const resource = opened.snapshot.resources.find(
          ({ manifest }) => String(manifest.id) === nativeId,
        );
        if (resource?.kind !== 'typescript') throw new Error('Native proof resource missing');
        return window.tileborne.behaviors.saveTypeScript({
          projectId,
          behaviorId: resource.manifest.id,
          expectedRevision: opened.snapshot.revision,
          label: resource.manifest.label,
          source: `import { defineBehavior } from '@tileborne/game-sdk';\nexport default defineBehavior({`,
          exportName: 'default',
          requiredCapabilities: [...resource.manifest.requiredCapabilities],
        });
      },
      { projectId: created.projectId, nativeId: authored.nativeId },
    );
    expect(invalidReload.snapshot.resources).toHaveLength(4);
    await expect
      .poll(
        async () =>
          page.evaluate(async (sessionId) => {
            const { snapshot } = await window.tileborne.playtest.behaviorDebugInspect({
              sessionId,
            });
            return snapshot.lastReload;
          }, session.id),
        { timeout: 15_000 },
      )
      .toMatchObject({
        behaviorId: authored.nativeId,
        status: 'rejected-using-last-known-good',
        diagnostic: {
          severity: 'error',
          message: expect.any(String),
          suggestion: expect.stringContaining('Fix the TypeScript syntax error'),
        },
      });

    await page.evaluate(
      async ({ projectId, nativeId, source }) => {
        const opened = await window.tileborne.behaviors.open({ projectId });
        const resource = opened.snapshot.resources.find(
          ({ manifest }) => String(manifest.id) === nativeId,
        );
        if (resource?.kind !== 'typescript') throw new Error('Native proof resource missing');
        await window.tileborne.behaviors.saveTypeScript({
          projectId,
          behaviorId: resource.manifest.id,
          expectedRevision: opened.snapshot.revision,
          label: resource.manifest.label,
          source,
          exportName: 'default',
          requiredCapabilities: [...resource.manifest.requiredCapabilities],
        });
      },
      {
        projectId: created.projectId,
        nativeId: authored.nativeId,
        source: nativeSource('goal-oracle.native-proof', "state.set('proof', true)"),
      },
    );
    await expect
      .poll(
        async () =>
          page.evaluate(
            async (sessionId) =>
              (await window.tileborne.playtest.behaviorDebugInspect({ sessionId })).snapshot
                .lastReload?.status,
            session.id,
          ),
        { timeout: 15_000 },
      )
      .toBe('applied');

    await page.evaluate(
      async ({ projectId, runawayId, source }) => {
        const opened = await window.tileborne.behaviors.open({ projectId });
        const resource = opened.snapshot.resources.find(
          ({ manifest }) => String(manifest.id) === runawayId,
        );
        if (resource?.kind !== 'typescript') throw new Error('Runaway proof resource missing');
        await window.tileborne.behaviors.saveTypeScript({
          projectId,
          behaviorId: resource.manifest.id,
          expectedRevision: opened.snapshot.revision,
          label: resource.manifest.label,
          source,
          exportName: 'default',
          requiredCapabilities: [...resource.manifest.requiredCapabilities],
        });
      },
      {
        projectId: created.projectId,
        runawayId: authored.runawayId,
        source: nativeSource('goal-oracle.runaway-proof', '(() => { while (true) {} })()'),
      },
    );
    await expect
      .poll(
        async () =>
          page.evaluate(async (sessionId) => {
            const { sessions } = await window.tileborne.playtest.list({});
            return sessions.find(({ id }) => id === sessionId)?.runtimeMetrics?.lastPluginEvent;
          }, session.id),
        { timeout: 30_000, intervals: [100, 250, 500] },
      )
      .toContain('Behavior worker exceeded');
    await expect(page.getByTestId('playtest-menu-trigger')).toBeVisible();

    await page.evaluate(
      async ({ projectId, runawayId, source }) => {
        const opened = await window.tileborne.behaviors.open({ projectId });
        const resource = opened.snapshot.resources.find(
          ({ manifest }) => String(manifest.id) === runawayId,
        );
        if (resource?.kind !== 'typescript') throw new Error('Runaway proof resource missing');
        await window.tileborne.behaviors.saveTypeScript({
          projectId,
          behaviorId: resource.manifest.id,
          expectedRevision: opened.snapshot.revision,
          label: resource.manifest.label,
          source,
          exportName: 'default',
          requiredCapabilities: [...resource.manifest.requiredCapabilities],
        });
      },
      {
        projectId: created.projectId,
        runawayId: authored.runawayId,
        source: nativeSource('goal-oracle.runaway-proof', "state.set('proof', true)"),
      },
    );

    await page.getByTestId('bottom-drawer-open').click();
    await page.getByRole('tab', { name: /Runtime/ }).click();
    await expect(page.getByTestId('behavior-runtime-inspector')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Traces are retained per behavior instance/)).toBeVisible();

    await page.evaluate(async (sessionId) => {
      await window.tileborne.playtest.stop({ sessionId });
    }, session.id);
    await capture(context!, '03-runtime-behavior-diagnostics.png');
    await stopTrace(context!, '02-recovery-and-behavior-runtime.zip');
    await closeSmokeApp(context!);
    context = await launchElectron(tileborneHome);
    page = context.page;
    await startTrace(context);
    const reopened = await page.evaluate(
      async ({ projectId, ids }) => {
        const { snapshot } = await window.tileborne.behaviors.open({ projectId });
        return {
          revision: snapshot.revision,
          resources: snapshot.resources
            .filter(({ manifest }) => ids.includes(String(manifest.id)))
            .map((resource) => ({
              id: String(resource.manifest.id),
              kind: resource.kind,
              label: resource.manifest.label,
            })),
        };
      },
      {
        projectId: created.projectId,
        ids: [authored.visualId, authored.nativeId, authored.runawayId, authored.missingId],
      },
    );
    expect(reopened.resources).toHaveLength(4);
    expect(reopened.resources.map(({ kind }) => kind).sort()).toEqual([
      'typescript',
      'typescript',
      'visual',
      'visual',
    ]);

    await navigateToRoute(page, `/projects/${created.projectId}/maps/${created.mapId}`);
    await expect(page.getByTestId('battle-royale-authoring-panel')).toBeVisible({
      timeout: 30_000,
    });
    const fastMatchSettings = {
      maxPlayers: '2',
      waitSec: '1',
      shrinkSec: '1',
      holdSec: '1',
      shrinkPhases: '1',
      damagePerSecOutside: '100',
    } as const;
    for (const [key, value] of Object.entries(fastMatchSettings)) {
      await page.getByTestId(`br-setting-${key}`).fill(value);
    }
    await page.getByTestId('br-setting-save').click();
    await expect
      .poll(
        () =>
          page.evaluate(async ({ projectId, mapId }) => {
            const { map } = await window.tileborne.maps.get({ projectId, mapId });
            return map.properties['@tileborne-plugins/battle-royale'];
          }, created),
        { timeout: 15_000 },
      )
      .toMatchObject({
        maxPlayers: 2,
        zone: {
          damagePerSecOutside: 100,
          schedule: { waitSec: 1, shrinkSec: 1, holdSec: 1, shrinkPhases: 1 },
        },
      });
    await expect(page.getByTestId('readiness-status')).toContainText(/Ready|warnings/, {
      timeout: 30_000,
    });

    await page.getByTestId('playtest-menu-trigger').click();
    await page.getByTestId('playtest-menu-host').click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            JSON.stringify({
              dialog: document.querySelector('[data-testid="playtest-host-dialog"]') !== null,
              alerts: [...document.querySelectorAll('[role="alert"]')].map(
                (element) => element.textContent,
              ),
              notifications: [...document.querySelectorAll('[data-sonner-toast]')].map(
                (element) => element.textContent,
              ),
              bodyTail: (document.body.textContent ?? '').slice(-2_000),
            }),
          ),
        { timeout: 30_000, intervals: [100, 250, 500] },
      )
      .toMatch(/^\{"dialog":true,/);
    await expect(page.getByTestId('playtest-host-room-url')).not.toHaveValue('', {
      timeout: 120_000,
    });
    const secondaryWindow = context.app.waitForEvent('window', { timeout: 30_000 });
    await page.getByTestId('playtest-host-open-second-client').click();
    const secondaryPage = await secondaryWindow;
    await secondaryPage.waitForLoadState('domcontentloaded');
    await secondaryPage.waitForFunction(() => typeof window.tileborne === 'object', undefined, {
      timeout: 30_000,
    });
    await expect(secondaryPage.getByTestId('playtest-multiplayer-viewport')).toBeVisible({
      timeout: 120_000,
    });
    await page.getByRole('button', { name: 'Join as host', exact: true }).click();
    await expect(page.getByTestId('playtest-multiplayer-viewport')).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId('multiplayer-lobby')).toBeVisible({ timeout: 30_000 });
    await expect(secondaryPage.getByTestId('multiplayer-lobby')).toBeVisible({ timeout: 30_000 });
    await secondaryPage.getByTestId('multiplayer-ready-toggle').click();
    await page.getByTestId('multiplayer-ready-toggle').click();
    await expect(page.getByTestId('multiplayer-lobby')).toBeHidden({ timeout: 60_000 });
    await expect(secondaryPage.getByTestId('multiplayer-lobby')).toBeHidden({ timeout: 60_000 });
    await expect(page.getByTestId('playtest-multiplayer-canvas')).toBeVisible();
    await expect(secondaryPage.getByTestId('playtest-multiplayer-canvas')).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const state = window.__tileborne_e2e?.getMultiplayerSessionState?.();
            return state === null || state === undefined
              ? undefined
              : {
                  tick: state.tick,
                  playerCount: state.players.length,
                  localPlayerId: state.localPlayerId,
                  zoneRadius: state.zone?.radius,
                };
          }),
        { timeout: 120_000, intervals: [250, 500, 1_000] },
      )
      .toMatchObject({
        tick: expect.any(Number),
        playerCount: 2,
        localPlayerId: expect.any(String),
        zoneRadius: expect.any(Number),
      });
    await capture(context, '04-multiplayer-live-host.png');
    const secondaryScreenshot = artifactPath('05-multiplayer-live-secondary.png');
    if (secondaryScreenshot !== undefined) {
      await secondaryPage.screenshot({ path: secondaryScreenshot, fullPage: true });
    }
    await expect
      .poll(
        async () =>
          (await page
            .getByTestId('multiplayer-results')
            .isVisible()
            .catch(() => false)) ||
          (await secondaryPage
            .getByTestId('multiplayer-results')
            .isVisible()
            .catch(() => false)),
        { timeout: 120_000, intervals: [500, 1_000] },
      )
      .toBe(true);
    const resultsPage = (await page.getByTestId('multiplayer-results').isVisible())
      ? page
      : secondaryPage;
    const resultsText = await resultsPage.getByTestId('multiplayer-results').innerText();
    expect(resultsText).toContain('Results');
    expect(resultsText).toMatch(/#1|winner|victory|finished/i);
    const resultsScreenshot = artifactPath('06-multiplayer-results.png');
    if (resultsScreenshot !== undefined) {
      await resultsPage.screenshot({ path: resultsScreenshot, fullPage: true });
    }
    await page.evaluate(async () => window.tileborne.runtime.stopLocalHost({}));
    await secondaryPage.close().catch(() => undefined);

    await navigateToRoute(page, `/projects/${created.projectId}`);
    await page.getByTestId('overview-ship-game').click();
    const dialog = page.getByTestId('ship-game-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('ship-game-start').click();
    let jobId: string | undefined;
    await expect
      .poll(
        async () =>
          page
            .evaluate(async () => {
              const { jobs } = await window.tileborne.jobs.list({});
              return jobs.find(
                ({ status, result }) => status !== 'Completed' || result !== undefined,
              )?.id;
            })
            .then((value) => {
              jobId = value;
              return value;
            }),
        { timeout: 15_000 },
      )
      .toMatch(/^job:/);
    const completed = await waitForJob(page, jobId!, 120_000);
    expect(completed.status, completed.errorMessage).toBe('Completed');
    await expect(page.getByTestId('ship-artifact')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ship-logs')).toContainText('Artifact verified');

    const artifact = await page.evaluate(async (startupMapId) => {
      const { jobs } = await window.tileborne.jobs.list({});
      const result = jobs
        .filter(({ status }) => status === 'Completed')
        .map(({ result }) => result)
        .find(
          (value) =>
            typeof value === 'object' &&
            value !== null &&
            'startupMapId' in value &&
            value.startupMapId === startupMapId,
        );
      if (typeof result !== 'object' || result === null || !('directory' in result)) {
        throw new Error('Ship Game artifact missing');
      }
      return result as { readonly directory: string; readonly files: readonly string[] };
    }, created.mapId);
    expect(artifact.files.some((file) => file.includes('behavior'))).toBe(true);
    await capture(context, '07-ship-game-verified.png');
    await stopTrace(context, '03-multiplayer-and-ship.zip');

    const receiptTarget = artifactPath('receipt.json');
    if (receiptTarget !== undefined) {
      const evidence = await Promise.all(
        [
          '01-authoring-and-durable-draft.zip',
          '01-durable-draft-before-interruption.png',
          '02-recovered-draft-after-interruption.png',
          '02-recovery-and-behavior-runtime.zip',
          '03-multiplayer-and-ship.zip',
          '03-runtime-behavior-diagnostics.png',
          '04-multiplayer-live-host.png',
          '05-multiplayer-live-secondary.png',
          '06-multiplayer-results.png',
          '07-ship-game-verified.png',
        ].map(async (name) => {
          const bytes = await readFile(path.join(ORACLE_ARTIFACTS!, name));
          return {
            name,
            bytes: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          };
        }),
      );
      await writeFile(
        receiptTarget,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            runId: ORACLE_RUN_ID,
            gitHead: process.env.TILEBORNE_CREATOR_ORACLE_GIT_HEAD ?? null,
            checkoutRoot: process.env.TILEBORNE_CREATOR_ORACLE_CHECKOUT ?? process.cwd(),
            checkoutStatus: process.env.TILEBORNE_CREATOR_ORACLE_GIT_STATUS ?? null,
            profileRoot: tileborneHome,
            projectId: created.projectId,
            mapId: created.mapId,
            shippedArtifactDirectory: artifact.directory,
            flows: {
              freshProfileUiStarter: 'passed',
              visualBehavior: authored.visualId,
              typescriptBehavior: authored.nativeId,
              readinessRepair: authored.missingId,
              durableInterruptionRecovery: 'passed',
              saveReopen: 'passed',
              behaviorDiagnostics: 'passed',
              multiplayerDiagnostics: 'passed',
              multiplayerResults: resultsText,
              shipGameUiIpc: 'passed',
            },
            evidence,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    }

    const isolatedRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-behavior-goal-oracle-'));
    isolatedArtifacts.push(isolatedRoot);
    const isolatedArtifact = path.join(isolatedRoot, 'game');
    await cp(artifact.directory, isolatedArtifact, { recursive: true });
    const workerPath = path.join(isolatedArtifact, 'worker.js');
    const behaviorWorkerPath = path.join(isolatedArtifact, 'behavior-worker.js');
    const workerSource = await readFile(workerPath, 'utf8');
    expect(workerSource).not.toContain(path.resolve(import.meta.dirname, '../../../..'));

    const host = await createLocalGameHost({
      port: 19_873,
      workerPath,
      behaviorWorkerPath,
    });
    try {
      const health = await host.fetch('/health');
      expect(health.status).toBe(200);
      const room = await host.fetch('/rooms/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: created.mapId,
          options: { idempotencyKey: 'behavior-goal-oracle-copy' },
        }),
      });
      expect(room.status, await room.clone().text()).toBe(201);
      const createdRoom = (await room.json()) as { readonly roomId: string };
      const summary = await host.fetch(`/playtest/${createdRoom.roomId}`);
      expect(summary.status, await summary.clone().text()).toBe(200);
      expect(await summary.json()).toMatchObject({ mapId: created.mapId });
    } finally {
      await host.stop();
    }
  }, 600_000);
});
