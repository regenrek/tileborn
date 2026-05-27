---
title: Tileborne
description: Open-source tilemap editor and multiplayer game runtime platform.
template: splash
hero:
  tagline: Build tilemap games with a desktop editor, typed CLI, and Cloudflare game host.
  actions:
    - text: Get started
      link: /getting-started/
      icon: right-arrow
      variant: primary
    - text: Architecture
      link: /architecture/
      variant: minimal
---

## What is Tileborne?

Tileborne is an open-source platform for authoring 2D tilemap games and shipping multiplayer sessions to Cloudflare Workers. It combines:

- **Desktop editor** — Electron + React + Pixi map authoring shell
- **CLI** — project, asset, plugin, map, and deploy workflows shared with the desktop app
- **Runtime SDK** — renderer-agnostic simulation and networking primitives
- **Game host** — build-time bundled Workers + Durable Objects room runtime

Plugins extend the editor and runtime through declarative manifests and build-time bundles—executable plugin code never runs in the renderer during Phase A.

## Explore the docs

| Guide | Description |
| --- | --- |
| [Getting Started](/getting-started/) | Install the CLI, init a project, open the editor, build a Cloudflare target |
| [Architecture](/architecture/) | Monorepo package map and process boundaries |
| [Plugins](/plugins/) | Manifest schema, contribution points, battle-royale reference |
| [CLI Reference](/cli/) | Generated `tileborne --help` command tree |
| [API Reference](/reference/) | TypeDoc output for public packages |

## Public packages

- `@tileborne/core` — domain models and shared utilities
- `@tileborne/runtime` — game runtime SDK
- `@tileborne/plugin-api` — plugin manifest and registry types
- `@tileborne/ipc-contracts` — desktop IPC schemas
- `@tileborne/cli` — platform CLI
