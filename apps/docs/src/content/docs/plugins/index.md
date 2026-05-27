---
title: Plugins
description: Plugin manifests, contribution points, permissions, and the battle-royale reference plugin.
---

# Plugins

Tileborne plugins extend the editor (declarative UI contributions) and the runtime (simulation systems, validators, exporters). Executable plugin code runs in Electron main, the CLI, or the bundled game host—never in the renderer during Phase A.

## Manifest

Each plugin ships a `tileborne-plugin.json` manifest validated by `@tileborne/plugin-api`:

```json
{
  "id": "example.gameplay",
  "name": "Example Gameplay",
  "version": "0.1.0",
  "engineRange": "^0.0.0",
  "contributions": {
    "paletteCategories": [],
    "inspectorPanels": [],
    "validators": [],
    "exporters": [],
    "runtimeSystems": []
  }
}
```

See the generated [plugin-api reference](/reference/plugin-api/) for the full schema and contribution types.

## Contribution points

| Point | Purpose |
| --- | --- |
| `paletteCategories` | Asset browser tabs and grouping |
| `inspectorPanels` | Selection-side property editors |
| `overlays` | Viewport overlays (grid helpers, gameplay hints) |
| `validators` | Map lint rules before export/playtest |
| `exporters` | Target-specific map/runtime export pipelines |
| `generators` | Procedural fill / layout dialogs |
| `runtimeSystems` | Registered simulation systems for playtest and game host |

Contributions are declarative JSON/metadata in v1. The React shell in `@tileborne/ui` maps declarations to components.

## Permissions

Plugins declare requested capabilities (filesystem paths, network, IPC channels). The platform enforces permissions in main/CLI/host contexts. Undeclared access is rejected at load time.

## Battle-royale reference plugin

The OSS `tileborne-plugins` repository publishes a **battle-royale** reference plugin demonstrating:

- Gameplay palette and inspector contributions
- BR-specific validators and exporters
- Runtime systems for zone shrink and elimination rules
- Cloudflare bundle wiring consumed by `tileborne game build`

Install from a separate plugins workspace:

```bash
tileborne plugin add battle-royale
```

## CLI workflows

```bash
tileborne plugin list
tileborne plugin add <id>
tileborne plugin validate
```

## Related docs

- [ADR-0001: Plugin UI model, declarative first](/adrs/0001-plugin-ui-model-declarative-first/)
- [ADR-0004: Cloudflare build-time plugin bundling](/adrs/0004-cloudflare-build-time-plugin-bundling/)
- [API Reference: @tileborne/plugin-api](/reference/plugin-api/)
