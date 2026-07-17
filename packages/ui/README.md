# `@tileborne/ui`

Shared shadcn/Radix UI primitives for Tileborne apps. All desktop renderer components consume primitives from this package — do not duplicate them under `apps/desktop`.

## Usage

```tsx
import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@tileborne/ui';
import '@tileborne/ui/styles/index.css';
```

Build the package before typechecking dependents:

```bash
pnpm --filter @tileborne/ui build
```

## Adding components

Run shadcn from the **ui package root** (not the desktop app):

```bash
cd packages/ui
pnpm dlx shadcn@latest add <component>
```

`packages/ui/components.json` is the canonical shadcn config. Primitives added here are exported from `src/index.ts`.

## Desktop migration (c-ggx0, c-th1b)

- **Hard-cut:** `apps/desktop/src/renderer/components/ui/` must stay empty. Import all primitives from `@tileborne/ui`.
- **Desktop `components.json`:** aliases point at `packages/ui` so `shadcn add` from `apps/desktop` writes into the shared package. Re-run shadcn from desktop only when intentionally adding a renderer-local wrapper (rare).
- **Tailwind:** desktop renderer imports `@tileborne/ui/styles/index.css` tokens via its own `index.css`; keep theme tokens in the ui package as SSOT.
- **First consumers:** Accordion and Resizable were added for the editor shell resizable pane layout.

## Testing

```bash
pnpm --filter @tileborne/ui test -- --run
pnpm --filter @tileborne/ui typecheck
```

See `docs/01-spec.md` §3 for architecture context.
