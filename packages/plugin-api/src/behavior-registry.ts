import {
  BehaviorRegistryManifest,
  CORE_BEHAVIOR_REGISTRY,
  CORE_BEHAVIOR_TEMPLATES,
  type BehaviorCapabilityId,
  type BehaviorRegistryEntry,
  type BehaviorRegistryEntryKind,
  type BehaviorTemplate,
  type PluginId,
} from '@tileborne/core';

import type { PluginContributions } from './contributions.js';

export interface BehaviorContributionSource {
  readonly pluginId: PluginId;
  readonly contributions: PluginContributions;
}

export interface EffectiveBehaviorAuthoringRegistry {
  readonly registry: BehaviorRegistryManifest;
  readonly templates: readonly BehaviorTemplate[];
  /** Every capability named by a registered block, in deterministic owner order. */
  readonly capabilities: readonly BehaviorCapabilityId[];
  readonly entryOwners: Readonly<Record<string, 'core' | PluginId>>;
  readonly templateOwners: Readonly<Record<string, 'core' | PluginId>>;
  /** A capability has exactly one declaration owner; templates may consume it. */
  readonly capabilityOwners: Readonly<Record<string, 'core' | PluginId>>;
}

const invocationKind = (
  templateId: string,
  entryId: string,
  expected: BehaviorRegistryEntryKind,
  entries: ReadonlyMap<string, BehaviorRegistryEntry>,
): void => {
  const entry = entries.get(entryId);
  if (entry === undefined) {
    throw new Error(`behavior template ${templateId} references missing registry entry ${entryId}`);
  }
  if (entry.kind !== expected) {
    throw new Error(
      `behavior template ${templateId} expects ${entryId} to be ${expected}, found ${entry.kind}`,
    );
  }
};

/**
 * One deterministic projection consumed by editor, readiness and compilers.
 * Plugin order never affects output: contributions are sorted by plugin/id.
 */
export const resolveBehaviorAuthoringRegistry = (
  sources: readonly BehaviorContributionSource[],
): EffectiveBehaviorAuthoringRegistry => {
  const entries = new Map<string, BehaviorRegistryEntry>();
  const templates = new Map<string, BehaviorTemplate>();
  const entryOwners: Record<string, 'core' | PluginId> = {};
  const templateOwners: Record<string, 'core' | PluginId> = {};
  const capabilityOwners: Record<string, 'core' | PluginId> = {};
  const capabilities: BehaviorCapabilityId[] = [];

  const claimCapability = (capability: BehaviorCapabilityId, owner: 'core' | PluginId): void => {
    const id = String(capability);
    const existingOwner = capabilityOwners[id];
    if (existingOwner !== undefined && existingOwner !== owner) {
      throw new Error(
        `behavior capability ${id} from ${owner} is already owned by ${existingOwner}`,
      );
    }
    if (existingOwner === undefined) capabilities.push(capability);
    capabilityOwners[id] = owner;
  };

  const addEntry = (entry: BehaviorRegistryEntry, owner: 'core' | PluginId): void => {
    const existingOwner = entryOwners[String(entry.id)];
    if (existingOwner !== undefined) {
      throw new Error(
        `duplicate behavior registry entry ${entry.id} from ${owner}; already owned by ${existingOwner}`,
      );
    }
    entries.set(String(entry.id), entry);
    entryOwners[String(entry.id)] = owner;
    claimCapability(entry.capability, owner);
  };
  const addTemplate = (template: BehaviorTemplate, owner: 'core' | PluginId): void => {
    const existingOwner = templateOwners[String(template.id)];
    if (existingOwner !== undefined) {
      throw new Error(
        `duplicate behavior template ${template.id} from ${owner}; already owned by ${existingOwner}`,
      );
    }
    templates.set(String(template.id), template);
    templateOwners[String(template.id)] = owner;
  };

  for (const entry of CORE_BEHAVIOR_REGISTRY.entries) addEntry(entry, 'core');
  for (const template of CORE_BEHAVIOR_TEMPLATES) addTemplate(template, 'core');

  const orderedSources = [...sources].sort((left, right) =>
    String(left.pluginId).localeCompare(String(right.pluginId)),
  );
  for (const source of orderedSources) {
    for (const entry of [...(source.contributions.behaviorEntries ?? [])].sort((left, right) =>
      String(left.id).localeCompare(String(right.id)),
    )) {
      addEntry(entry, source.pluginId);
    }
    for (const template of [...(source.contributions.behaviorTemplates ?? [])].sort((left, right) =>
      String(left.id).localeCompare(String(right.id)),
    )) {
      addTemplate(template, source.pluginId);
    }
  }

  for (const template of templates.values()) {
    const requiredCapabilities = new Set(template.requiredCapabilities.map(String));
    for (const capability of template.requiredCapabilities) {
      if (capabilityOwners[String(capability)] === undefined) {
        throw new Error(
          `behavior template ${template.id} requires unknown capability ${capability}`,
        );
      }
    }

    const assertInvocation = (entryId: string, expected: BehaviorRegistryEntryKind): void => {
      invocationKind(String(template.id), entryId, expected, entries);
      const entry = entries.get(entryId)!;
      if (!requiredCapabilities.has(String(entry.capability))) {
        throw new Error(
          `behavior template ${template.id} invokes ${entryId} but does not require capability ${entry.capability}`,
        );
      }
    };
    assertInvocation(String(template.when.entryId), 'event');
    for (const condition of template.if ?? []) {
      assertInvocation(String(condition.entryId), 'condition');
    }
    for (const action of template.do) {
      assertInvocation(String(action.entryId), 'action');
    }
  }

  return {
    registry: new BehaviorRegistryManifest({ schemaVersion: 1, entries: [...entries.values()] }),
    templates: [...templates.values()],
    capabilities,
    entryOwners,
    templateOwners,
    capabilityOwners,
  };
};
