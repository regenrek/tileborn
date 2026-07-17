import { Schema } from 'effect';

export const PluginContributionZone = Schema.Literals([
  'project',
  'working-palette',
  'assets',
  'plugins',
]);
export type PluginContributionZone = typeof PluginContributionZone.Type;
