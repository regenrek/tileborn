import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prettierConfig = (await resolveConfig(root)) ?? {};
const inventory = JSON.parse(await readFile(resolve(root, 'capabilities.registry.json'), 'utf8'));

if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.capabilities)) {
  throw new TypeError(
    'TBSDK3001: capability inventory must use schemaVersion 1 and a capabilities array',
  );
}
const capabilityIds = new Set();
for (const capability of inventory.capabilities) {
  if (
    typeof capability.id !== 'string' ||
    !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(capability.id) ||
    typeof capability.label !== 'string' ||
    typeof capability.description !== 'string'
  ) {
    throw new TypeError('TBSDK3002: every capability needs a dotted id, label, and description');
  }
  if (capabilityIds.has(capability.id)) {
    throw new TypeError(`TBSDK3003: duplicate capability id "${capability.id}"`);
  }
  capabilityIds.add(capability.id);
}

const generatedSource = `/* Generated from capabilities.registry.json. Do not edit. */
export const capabilityInventory = ${JSON.stringify(inventory, null, 2)} as const;

export type BuiltInCapabilityId = (typeof capabilityInventory.capabilities)[number]["id"];

export const builtInCapabilityIds = capabilityInventory.capabilities.map(
  (entry) => entry.id,
) as ReadonlyArray<BuiltInCapabilityId>;
`;

const rows = inventory.capabilities
  .map((entry) => {
    const members = [
      ...(entry.events ?? []),
      ...(entry.conditions ?? []),
      ...(entry.actions ?? []),
    ];
    return `| \`${entry.id}\` | ${entry.label} | ${entry.description} | ${members.map((member) => `\`${member}\``).join(', ')} |`;
  })
  .join('\n');

const generatedDocs = `# Tileborne game SDK capabilities

This file is generated from \`capabilities.registry.json\`. Agents and tools can read the JSON inventory through the \`@tileborne/game-sdk/capabilities.json\` export.

| Capability | Label | Purpose | Built-in members |
| --- | --- | --- | --- |
${rows}

Plugins extend the open TypeScript registries through declaration merging. Their generated project declarations remain normal native TypeScript and do not introduce a language subset.
`;

await writeFile(
  resolve(root, 'src/generated/capabilities.ts'),
  await format(generatedSource, {
    ...prettierConfig,
    filepath: resolve(root, 'src/generated/capabilities.ts'),
  }),
);
await writeFile(
  resolve(root, 'CAPABILITIES.md'),
  await format(generatedDocs, {
    ...prettierConfig,
    filepath: resolve(root, 'CAPABILITIES.md'),
  }),
);
