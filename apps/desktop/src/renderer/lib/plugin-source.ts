/** Renderer-safe plugin install source shapes (IPC payload only — no main-process services). */

export type LocalPluginInstallSource = {
  readonly _tag: 'local';
  readonly path: string;
};

export type PluginInstallSource = LocalPluginInstallSource;

export const localPluginSource = (path: string): LocalPluginInstallSource => ({
  _tag: 'local',
  path,
});
