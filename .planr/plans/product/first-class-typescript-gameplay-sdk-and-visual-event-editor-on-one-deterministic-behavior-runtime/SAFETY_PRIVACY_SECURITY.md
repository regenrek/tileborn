# Safety Privacy Security

## Data Handling

Behavior source, diagnostics, traces, and generated artifacts remain project-local
unless the user invokes an existing explicit publish/export path. Debug traces must
cap payload/retention and redact secret-like values and filesystem details.

## Secrets

Gameplay code receives no environment variables, Electron APIs, filesystem access,
credentials, or implicit network access. SDK capability additions require an owned
declaration, validation, runtime handler, documentation, and security review.

## Abuse Cases

- Imported project contains malicious TypeScript: require project trust before
  compilation/execution and keep it inside the restricted behavior runtime.
- Infinite loop, recursion, timer storm, event recursion, spawn/action flood, or
  memory growth: enforce execution, nesting, queue, action, time, and memory budgets.
- Forbidden imports or dynamic loading: resolver allowlists SDK/project-safe modules
  and rejects Node/Electron/platform packages and unresolved dynamic imports.
- Nondeterminism or hidden I/O: provide seeded RNG/tick/timers through context and
  reject or remove direct time/random/network/process globals.
