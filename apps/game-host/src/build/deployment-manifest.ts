import type { ContentHash } from '@tileborne/core';

export const DEPLOYMENT_MANIFEST_SCHEMA_VERSION = 1 as const;

export type DeploymentAdapterOperation =
  | 'plan'
  | 'preview'
  | 'deploy'
  | 'status'
  | 'logs'
  | 'destroy';

export type DeploymentCredentialSource = 'provider-native-env' | 'provider-secret-store';

export interface DeploymentCredentialRequirement {
  readonly name: string;
  readonly source: DeploymentCredentialSource;
  readonly required: boolean;
}

export interface DeploymentAdapterManifest {
  readonly id: 'local' | 'alchemy-cloudflare';
  readonly provider: 'local' | 'cloudflare';
  readonly displayName: string;
  readonly operations: readonly DeploymentAdapterOperation[];
  readonly credentialRequirements: readonly DeploymentCredentialRequirement[];
  readonly ownsConfigFiles: readonly string[];
}

export interface DeploymentManifest {
  readonly schemaVersion: typeof DEPLOYMENT_MANIFEST_SCHEMA_VERSION;
  readonly defaultAdapter: 'local';
  readonly artifact: {
    readonly manifestPath: 'manifest.json';
    readonly workerPath: 'worker.js';
    readonly behaviorWorkerPath: 'behavior-worker.js';
    readonly runtimeBuildId: ContentHash;
  };
  readonly adapters: readonly DeploymentAdapterManifest[];
}

const adapterOperations: readonly DeploymentAdapterOperation[] = [
  'plan',
  'preview',
  'deploy',
  'status',
  'logs',
  'destroy',
];

export const buildDeploymentManifest = (input: {
  readonly runtimeBuildId: ContentHash;
}): DeploymentManifest => ({
  schemaVersion: DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
  defaultAdapter: 'local',
  artifact: {
    manifestPath: 'manifest.json',
    workerPath: 'worker.js',
    behaviorWorkerPath: 'behavior-worker.js',
    runtimeBuildId: input.runtimeBuildId,
  },
  adapters: [
    {
      id: 'local',
      provider: 'local',
      displayName: 'Local packaged preview',
      operations: adapterOperations,
      credentialRequirements: [],
      ownsConfigFiles: [],
    },
    {
      id: 'alchemy-cloudflare',
      provider: 'cloudflare',
      displayName: 'Alchemy Cloudflare Worker',
      operations: adapterOperations,
      credentialRequirements: [
        { name: 'CLOUDFLARE_ACCOUNT_ID', source: 'provider-native-env', required: true },
        { name: 'CLOUDFLARE_API_TOKEN', source: 'provider-native-env', required: true },
        { name: 'ALCHEMY_PASSWORD', source: 'provider-secret-store', required: true },
      ],
      ownsConfigFiles: ['wrangler.toml', 'wrangler.behavior.toml'],
    },
  ],
});
