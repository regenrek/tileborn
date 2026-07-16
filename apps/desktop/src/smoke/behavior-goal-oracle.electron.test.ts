import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalGameHost } from '@tileborne/game-host/local';
import type { Dialog, Page } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { expect } from './playwright-expect.js';

import { snapshotShippedArtifact } from '../../../../scripts/shipped-artifact-evidence.mjs';

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

const ORACLE_RUN_ID = process.env.TILEBORNE_CREATOR_ORACLE_RUN_ID ?? `local-${Date.now()}`;
const ORACLE_ARTIFACTS = process.env.TILEBORNE_CREATOR_ORACLE_ARTIFACTS;
const ORACLE_PREFLIGHT = process.env.TILEBORNE_CREATOR_ORACLE_PREFLIGHT;

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

const createVisualTickProof = async (
  page: Page,
  projectId: string,
  label: string,
): Promise<string> => {
  const beforeIds = await page.evaluate(async (owner) => {
    const { snapshot } = await window.tileborne.behaviors.open({ projectId: owner });
    return snapshot.resources.map(({ manifest }) => String(manifest.id));
  }, projectId);
  await page.getByLabel('Create behavior', { exact: true }).click();
  await expect(page.getByTestId('behavior-template-dialog')).toBeVisible();
  await page.getByText('Blank event sheet', { exact: true }).click();
  let behaviorId: string | undefined;
  await expect
    .poll(async () => {
      const createdId = await page.evaluate(
        async ({ owner, existingIds }) => {
          const { snapshot } = await window.tileborne.behaviors.open({ projectId: owner });
          return snapshot.resources.find(
            ({ manifest }) => !existingIds.includes(String(manifest.id)),
          )?.manifest.id;
        },
        { owner: projectId, existingIds: beforeIds },
      );
      behaviorId = createdId === undefined ? undefined : String(createdId);
      return behaviorId;
    })
    .toMatch(/^behavior:/);
  const createdOption = page.locator(`[data-behavior-id="${behaviorId}"]`);
  await expect(createdOption).toBeVisible();
  if ((await createdOption.getAttribute('aria-selected')) !== 'true') await createdOption.click();
  await expect(createdOption).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('behavior-event-sheet')).toBeVisible();
  await page.locator('#behavior-label').fill(label);
  await page.getByRole('button', { name: 'Add state' }).click();
  await page.getByLabel('State key').fill('proof');
  await page.getByLabel('State label').fill('Proof');
  await page.getByLabel('Initial state value').fill('false');
  await page.getByLabel('Initial state value').blur();
  await page.getByRole('button', { name: 'Choose event block' }).click();
  await page.getByRole('option', { name: /Simulation tick/ }).click();
  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByRole('option', { name: /Set local state/ }).click();
  await page.getByRole('textbox', { name: 'State field', exact: true }).fill('proof');
  await page.getByLabel('JSON value').fill('true');
  await page.getByLabel('JSON value').blur();
  const save = page.getByRole('button', { name: /^Save$/ });
  await save.click();
  await expect(page.getByText(`Saved ${label}`, { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      return page.evaluate(
        async ({ owner, id }) => {
          const { snapshot } = await window.tileborne.behaviors.open({ projectId: owner });
          return snapshot.resources.find(({ manifest }) => String(manifest.id) === id)?.manifest
            .label;
        },
        { owner: projectId, id: behaviorId! },
      );
    })
    .toBe(label);
  await expect(page.getByRole('option', { name: new RegExp(label) })).toBeVisible({
    timeout: 15_000,
  });
  return behaviorId!;
};

const saveTypeScriptThroughEditor = async (
  page: Page,
  projectId: string,
  label: string,
  source: string,
): Promise<void> => {
  await expect(page.locator('[role="option"][aria-selected="true"]')).toBeVisible();
  const option = page.getByRole('option', { name: new RegExp(label) });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await option.click();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    if ((await option.getAttribute('aria-selected')) === 'true') break;
  }
  await expect(option).toHaveAttribute('aria-selected', 'true');
  const editor = page.getByLabel('TypeScript behavior source');
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.selectText();
  await page.keyboard.insertText(source);
  const save = page
    .getByTestId('typescript-behavior-document')
    .getByRole('button', { name: 'Save' });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selected = document.querySelector('[role="option"][aria-selected="true"]');
        const sourceEditor = document.querySelector<HTMLTextAreaElement>(
          '[aria-label="TypeScript behavior source"]',
        );
        const documentRoot = document.querySelector('[data-testid="typescript-behavior-document"]');
        const saveButton = documentRoot?.querySelector<HTMLButtonElement>('button');
        return {
          hash: window.location.hash,
          selected: selected?.textContent ?? null,
          source: sourceEditor?.value ?? null,
          documentVisible: documentRoot !== null,
          saveDisabled: saveButton?.disabled ?? null,
        };
      }),
    )
    .toMatchObject({
      selected: expect.stringContaining(label),
      hash: expect.stringContaining('/behaviors'),
      source,
      documentVisible: true,
      saveDisabled: false,
    });
  await save.click();
  await expect
    .poll(() =>
      page.evaluate(
        async ({ owner, expectedLabel }) => {
          const { snapshot } = await window.tileborne.behaviors.open({ projectId: owner });
          const resource = snapshot.resources.find(
            ({ manifest }) => manifest.label === expectedLabel,
          );
          return resource?.kind === 'typescript' ? resource.source : undefined;
        },
        { owner: projectId, expectedLabel: label },
      ),
    )
    .toBe(source);
  await expect(editor).toHaveValue(source);
  await expect(save).toBeDisabled();
};

const reopenBehaviorEditor = async (
  page: Page,
  projectId: string,
  mapId: string,
): Promise<void> => {
  await navigateToRoute(page, `/projects/${projectId}/maps/${mapId}`);
  await expect(page.getByTestId('battle-royale-authoring-panel')).toBeVisible();
  await navigateToRoute(page, `/projects/${projectId}/behaviors`);
  await expect(page.getByTestId('behavior-editor-page')).toBeVisible();
};

const addBehaviorReferenceThroughEditor = async (
  page: Page,
  projectId: string,
  behaviorLabel: string,
  referencedBehaviorLabel: string,
): Promise<string> => {
  const option = page.getByRole('option', { name: new RegExp(behaviorLabel) });
  await option.click();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('behavior-event-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByRole('option', { name: /Run behavior/ }).click();
  await page.getByLabel('Behavior source').selectOption('reference');
  const picker = page.getByTestId('behavior-reference-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('option', { name: new RegExp(referencedBehaviorLabel) }).click();
  await expect(page.getByRole('button', { name: 'Behavior', exact: true })).toContainText(
    referencedBehaviorLabel,
  );
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByText(`Saved ${behaviorLabel}`, { exact: true })).toBeVisible();
  let nodeId: string | undefined;
  await expect
    .poll(async () => {
      const result = await page.evaluate(
        async ({ owner, label }) => {
          const { snapshot } = await window.tileborne.behaviors.open({ projectId: owner });
          const resource = snapshot.resources.find(({ manifest }) => manifest.label === label);
          if (resource?.kind !== 'visual') return undefined;
          const action = resource.definition.do.find(
            (candidate) =>
              candidate._tag === 'action' && candidate.invocation.entryId === 'behavior.invoke',
          );
          return action?.nodeId === undefined ? undefined : String(action.nodeId);
        },
        { owner: projectId, label: behaviorLabel },
      );
      nodeId = result;
      return result;
    })
    .toMatch(/^behavior-node:/);
  return nodeId!;
};

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

    await navigateToRoute(page, `/projects/${created.projectId}/behaviors`);
    await expect(page.getByTestId('behavior-editor-page')).toBeVisible();
    const visualId = await createVisualTickProof(page, created.projectId, 'Visual Tick Proof');
    const nativeId = await createVisualTickProof(page, created.projectId, 'Native Tick Proof');
    const referenceTargetId = await createVisualTickProof(
      page,
      created.projectId,
      'Reference Target',
    );
    const missingReferenceId = await createVisualTickProof(
      page,
      created.projectId,
      'Missing Reference Proof',
    );
    const missingReferenceNodeId = await addBehaviorReferenceThroughEditor(
      page,
      created.projectId,
      'Missing Reference Proof',
      'Reference Target',
    );
    await reopenBehaviorEditor(page, created.projectId, created.mapId);
    const referenceTargetOption = page.getByRole('option', { name: /Reference Target/ });
    await referenceTargetOption.click();
    await expect(referenceTargetOption).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#behavior-label')).toHaveValue('Reference Target');
    await expect
      .poll(async () =>
        page.evaluate(
          async ({ owner, targetId }) => {
            const { snapshot } = await window.tileborne.behaviors.open({ projectId: owner });
            return snapshot.useSites.filter(({ behaviorId }) => String(behaviorId) === targetId)
              .length;
          },
          { owner: created.projectId, targetId: referenceTargetId },
        ),
      )
      .toBe(1);
    const deletePrompts: string[] = [];
    const acceptDelete = (dialog: Dialog) => {
      deletePrompts.push(dialog.message());
      return dialog.accept();
    };
    page.on('dialog', acceptDelete);
    await page.getByRole('button', { name: 'Delete behavior' }).click();
    await expect
      .poll(() => deletePrompts, { message: 'force-delete confirmation prompts' })
      .toContainEqual(expect.stringContaining('missing references'));
    await expect
      .poll(async () =>
        page.evaluate(
          async ({ owner, targetId }) => {
            const { snapshot } = await window.tileborne.behaviors.open({ projectId: owner });
            return snapshot.resources.some(({ manifest }) => String(manifest.id) === targetId);
          },
          { owner: created.projectId, targetId: referenceTargetId },
        ),
      )
      .toBe(false);
    page.off('dialog', acceptDelete);
    await expect(referenceTargetOption).toHaveCount(0);
    await expect
      .poll(async () =>
        page.evaluate(async (owner) => {
          const { snapshot } = await window.tileborne.behaviors.open({ projectId: owner });
          return snapshot.diagnostics.some(({ code }) => code === 'behavior.reference-missing');
        }, created.projectId),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        page.evaluate(async ({ projectId, mapId }) => {
          const { report } = await window.tileborne.readiness.check({
            projectId,
            mapId,
            purpose: 'authoring',
          });
          return report.diagnostics.some(({ code }) => code === 'behavior.reference-missing');
        }, created),
      )
      .toBe(true);

    await navigateToRoute(page, `/projects/${created.projectId}/maps/${created.mapId}`);
    await expect(page.getByTestId('readiness-status')).toContainText(/blocked/, {
      timeout: 15_000,
    });
    await page.getByTestId('readiness-status').click();
    await expect(page.getByTestId('readiness-problems')).toBeVisible();
    const missingProblem = page.locator(
      '[data-testid="readiness-problem"][data-source="behavior"]',
    );
    await expect(missingProblem).toContainText('Behavior reference is missing');
    await missingProblem.click();
    await expect(page.getByTestId('behavior-event-sheet')).toBeVisible();
    const missingReferenceNode = page.locator(`[data-node-id="${missingReferenceNodeId}"]`);
    await expect(missingReferenceNode).toBeFocused();
    await page.getByRole('button', { name: 'Behavior', exact: true }).click();
    const repairPicker = page.getByTestId('behavior-reference-picker');
    await expect(repairPicker).toBeVisible();
    await repairPicker.getByRole('option', { name: /Visual Tick Proof/ }).click();
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.getByText('Saved Missing Reference Proof', { exact: true })).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(async (owner) => {
          const { snapshot } = await window.tileborne.behaviors.open({ projectId: owner });
          return snapshot.diagnostics.some(({ code }) => code === 'behavior.reference-missing');
        }, created.projectId),
      )
      .toBe(false);
    await navigateToRoute(page, `/projects/${created.projectId}/maps/${created.mapId}`);
    await expect(page.getByTestId('readiness-status')).toContainText(/Ready|warnings/, {
      timeout: 15_000,
    });

    await navigateToRoute(page, `/projects/${created.projectId}/behaviors`);
    const nativeOption = page.getByRole('option', { name: /Native Tick Proof/ });
    await nativeOption.click();
    await expect(nativeOption).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Convert to TypeScript' }).click();
    await expect(page.getByTestId('behavior-convert-dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Convert permanently' }).click();
    await expect(page.getByTestId('typescript-behavior-document')).toBeVisible();
    await saveTypeScriptThroughEditor(
      page,
      created.projectId,
      'Native Tick Proof',
      nativeSource('goal-oracle.native-proof', "state.set('proof', true)"),
    );
    const runawayId = nativeId;
    const authored = { visualId, nativeId, runawayId, missingReferenceId };

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

    await navigateToRoute(page, `/projects/${created.projectId}/behaviors`);
    await saveTypeScriptThroughEditor(
      page,
      created.projectId,
      'Native Tick Proof',
      `import { defineBehavior } from '@tileborne/game-sdk';\nexport default defineBehavior({`,
    );
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

    await reopenBehaviorEditor(page, created.projectId, created.mapId);
    await saveTypeScriptThroughEditor(
      page,
      created.projectId,
      'Native Tick Proof',
      nativeSource('goal-oracle.native-proof', "state.set('proof', true)"),
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

    await reopenBehaviorEditor(page, created.projectId, created.mapId);
    await saveTypeScriptThroughEditor(
      page,
      created.projectId,
      'Native Tick Proof',
      nativeSource('goal-oracle.runaway-proof', '(() => { while (true) {} })()'),
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
    await expect(page.getByTestId('behavior-editor-page')).toBeVisible();

    await reopenBehaviorEditor(page, created.projectId, created.mapId);
    await saveTypeScriptThroughEditor(
      page,
      created.projectId,
      'Native Tick Proof',
      nativeSource('goal-oracle.runaway-proof', "state.set('proof', true)"),
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
        ids: [
          authored.visualId,
          authored.nativeId,
          authored.runawayId,
          authored.missingReferenceId,
        ],
      },
    );
    expect(reopened.resources).toHaveLength(3);
    expect(reopened.resources.map(({ kind }) => kind).sort()).toEqual([
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
                  playerCount: state.hud.totalPlayers,
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

    const shippedArtifactEvidence =
      ORACLE_ARTIFACTS === undefined
        ? undefined
        : await snapshotShippedArtifact({
            sourceDirectory: artifact.directory,
            evidenceRoot: ORACLE_ARTIFACTS,
          });

    const receiptTarget = artifactPath('receipt.json');
    if (receiptTarget !== undefined) {
      if (ORACLE_PREFLIGHT === undefined) {
        throw new Error('Artifact-producing creator Oracle requires runner preflight evidence.');
      }
      const preflightBytes = await readFile(ORACLE_PREFLIGHT);
      const preflight = JSON.parse(preflightBytes.toString('utf8')) as {
        readonly schemaVersion: number;
        readonly checkout: {
          readonly cwd: string;
          readonly cwdRealpath: string;
          readonly repositoryRoot: string;
          readonly gitHead: string;
          readonly state: string;
          readonly initialStatus: string;
          readonly postBuildStatus: string;
        };
      };
      const currentRoot = await realpath(path.resolve(process.cwd(), '../..'));
      if (
        preflight.schemaVersion !== 1 ||
        preflight.checkout.cwdRealpath !== currentRoot ||
        preflight.checkout.repositoryRoot !== currentRoot ||
        preflight.checkout.state !== 'detached' ||
        preflight.checkout.initialStatus !== '' ||
        preflight.checkout.postBuildStatus !== ''
      ) {
        throw new Error(`Creator Oracle runner preflight mismatch: ${JSON.stringify(preflight)}`);
      }
      const preflightSha256 = createHash('sha256').update(preflightBytes).digest('hex');
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
            runnerPreflight: {
              sha256: preflightSha256,
              gitHead: preflight.checkout.gitHead,
              checkoutRoot: preflight.checkout.repositoryRoot,
              state: preflight.checkout.state,
            },
            profileRoot: tileborneHome,
            projectId: created.projectId,
            mapId: created.mapId,
            shippedArtifact: shippedArtifactEvidence,
            flows: {
              freshProfileUiStarter: 'passed',
              visualBehavior: authored.visualId,
              typescriptBehavior: authored.nativeId,
              readinessRepair: 'problems-ui-passed',
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
    await cp(
      shippedArtifactEvidence === undefined
        ? artifact.directory
        : path.join(ORACLE_ARTIFACTS!, shippedArtifactEvidence.directory),
      isolatedArtifact,
      { recursive: true },
    );
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
