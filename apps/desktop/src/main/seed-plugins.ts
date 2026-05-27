import { Effect } from "effect";

import { LocalPluginSource, PluginInstallerService, PluginRegistryService } from "@tileborne/services-plugin";

import { BATTLE_ROYALE_PLUGIN_ID, resolveBattleRoyalePluginPath } from "./battle-royale-path.js";

export const installBundledBattleRoyalePlugin = Effect.gen(function* () {
  const registry = yield* PluginRegistryService;
  const installer = yield* PluginInstallerService;
  const installed = yield* registry.list();
  const existing = installed.find((plugin) => plugin.id === BATTLE_ROYALE_PLUGIN_ID);
  if (existing) {
    return existing.enabled ? existing : yield* registry.enable(existing.id);
  }
  const sourcePath = resolveBattleRoyalePluginPath();
  const plugin = yield* installer.install(new LocalPluginSource({ path: sourcePath }));
  if (!plugin.enabled) {
    return yield* registry.enable(plugin.id);
  }
  return plugin;
});

export const seedBattleRoyalePlugin = installBundledBattleRoyalePlugin.pipe(Effect.asVoid);
