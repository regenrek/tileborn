---
title: Getting Started
description: Install the Tileborne CLI, initialize a project, and run the editor and Cloudflare build target.
---

# Getting Started

This guide walks through the minimum path from zero to a local Tileborne project with editor and Cloudflare deploy artifacts.

## Prerequisites

- **Node.js 22+**
- **pnpm 11+** (Corepack recommended)
- macOS, Linux, or Windows for the desktop editor

Verify your toolchain:

```bash
node --version
pnpm --version
tileborne doctor
```

## Install the CLI

From the monorepo workspace (development):

```bash
pnpm install
pnpm --filter @tileborne/cli build
pnpm exec tileborne --help
```

When published to npm, installation will be:

```bash
pnpm add -g @tileborne/cli
```

## Initialize a project

```bash
tileborne project init my-game
cd my-game
tileborne doctor
```

The CLI creates a Tileborne home directory under `~/.tileborne`, writes project metadata, and prepares asset/plugin directories according to the project template.

## Open the desktop editor

Build and launch the desktop app from the monorepo:

```bash
pnpm --filter @tileborne/desktop build
pnpm --filter @tileborne/desktop dev
```

Open your project from the editor shell or point the CLI `dev` command at the project directory.

## Import assets and author a map

```bash
tileborne asset import ./art/tiles.png --kind tileset
tileborne map create main --width 64 --height 64
```

Use the editor viewport for tile painting, object placement, layers, and plugin-provided validators.

## Build the Cloudflare game host target

```bash
tileborne game build --target cloudflare
```

The build pipeline bundles the selected plugin runtime, asset pack manifest, and worker entry into a deployable artifact under the project build directory. See [Runtime & Game Host](/runtime/) for Durable Objects room semantics.

## Next steps

- [Architecture](/architecture/) — package boundaries and invariants
- [Plugins](/plugins/) — author a plugin manifest and contributions
- [CLI Reference](/cli/) — full command tree
