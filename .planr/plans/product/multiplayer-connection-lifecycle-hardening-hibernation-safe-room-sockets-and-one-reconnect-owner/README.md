# Multiplayer connection lifecycle hardening - hibernation-safe room sockets and one reconnect owner

## Summary

Harden Tileborne's existing authoritative multiplayer path so accepted
Cloudflare Durable Object WebSockets remain usable after isolate cold wake,
while client reconnect, queue, close-code, and health policy has one canonical
owner. This is a correctness and ownership goal, not a networking rewrite.

## Goals

- Reconstruct accepted room connections from Durable Object WebSocket
  attachments after a new isolate instance starts.
- Gate asynchronous room initialization so concurrent events see one coherent
  state and a failed initialization can be retried.
- Preserve the existing bounded input, snapshot, acknowledgement, resync, and
  backpressure behavior across wake and reconnect.
- Make `packages/runtime/src/net` the one reusable client reconnect-policy
  owner and remove the renderer's parallel WebSocket policy.
- Prove the result with deterministic workerd/Miniflare cold-wake coverage,
  fresh two-client Electron coverage, and a disposable Cloudflare lifecycle.

## Non-Goals

- Replacing `PlaytestRoom` with PartyServer or adopting PartySocket/Partysub.
- Adding matchmaking, spectator mode, chat, new game rules, or new wire
  features.
- Changing Battle Royale simulation or moving networking policy into a plugin.
- Upgrading Alchemy/Effect or the Cloudflare compatibility date in this goal.
- Creating the first-party tileset/sprite pack; that is a separate content
  goal.
- Creating or retaining a permanent production Worker.

## Assumptions

- The restored Planr board is authoritative; prior production and creator
  goals remain complete and are not reopened.
- Current reconnect-token, close-code, snapshot-ack, and backpressure
  semantics are correct unless focused evidence proves otherwise.
- Provider-specific socket attachment and hibernation mechanics stay inside
  `apps/game-host`; cross-client policy stays in `packages/runtime`.
- Real Cloudflare verification uses a newly authenticated default profile,
  disposable names, redacted receipts, and verified destroy.


## Refinement 2026-07-20T21:31:14.174885Z

ASSUMPTION: 'first important feature set' means the newly discovered highest-risk correctness gap: hibernation-safe Cloudflare Durable Object room sockets plus one canonical reconnect policy. First-party generated art and the Alchemy/Effect version upgrade are separate follow-up goals.

## Refinement 2026-07-20T21:31:14.254519Z

USER CONSTRAINT: apply architecture ownership before implementation. Runtime owner is apps/game-host PlaytestRoom for authoritative room execution. First-fix owner is the current room WebSocket lifecycle. Canonical long-term owners are apps/game-host/src/rooms for Cloudflare-specific hibernation lifecycle, packages/runtime/src/net for reusable reconnect and bounded queue policy, and packages/ipc-contracts for wire shapes. Renderer UI owns presentation only.

## Refinement 2026-07-20T21:31:14.335086Z

NO-DRIFT CONSTRAINT: do not add PartyServer or PartySocket as product dependencies, do not create a second room runtime, and do not duplicate reconnect, queue, close-code, or backpressure policy in renderer or plugins. Preserve existing bounded input/snapshot/backpressure behavior and reconnect-token semantics.

## Refinement 2026-07-20T21:31:14.413039Z

CLEANUP CONSTRAINT: remove or route around the direct renderer WebSocket policy once the canonical packages/runtime transport covers the flow; no compatibility fallback or parallel transport path remains.

## Refinement 2026-07-20T21:31:14.492695Z

PROVIDER CONSTRAINT: Cloudflare credentials are never copied or committed. A real deploy uses a newly authenticated default profile, disposable Tileborne worker names only, and verified cleanup; no permanent production Worker is in scope.

## Refinement 2026-07-20T21:31:14.572136Z

GOAL ORACLE: a fresh two-client Tileborne Electron flow connects through a disposable Cloudflare deployment, survives an actual Durable Object hibernation/cold-wake boundary, resumes authoritative input and snapshots without duplicate sessions or abnormal close 1006, exercises bounded reconnect/backpressure behavior, then destroys the disposable Workers and proves they are absent.

## Refinement 2026-07-20T21:32:33.70463Z

ORACLE INTERPRETATION: make cold-wake deterministic in a workerd/Miniflare integration harness that reconstructs a new PlaytestRoom instance over accepted WebSockets and serialized attachments. Separately prove the same protocol with two real Electron clients against disposable Cloudflare Workers. Do not make completion depend on Cloudflare choosing an undocumented hibernation time within a fixed wait.

## Refinement 2026-07-22T12:17:15.003263Z

EXECUTION CLARIFICATION for TASK-006: use Tileborne's existing RuntimeDeploymentAdapter id 'alchemy-cloudflare', the committed packages/services-build Alchemy stack, the official bundled Alchemy CLI, and a newly authenticated Alchemy profile named 'default'. Direct wrangler login/deploy/delete is not the canonical product path; provider-native CLI/API access is allowed only for redacted read-only absence verification when the current adapter has no status client. Never read, copy, print, or commit ~/.alchemy credential/profile files. If the existing RuntimeDeployCredentials shape prevents profile-only authentication without dummy/copied accountId or apiToken values, fix that narrow services-build auth boundary inside TASK-006 and independently review it rather than bypassing Alchemy. Do not upgrade Alchemy, add AWS support, add another provider adapter, or change content in this goal; multi-provider/AWS runtime mapping is a separate future plan.

## Refinement 2026-07-22T13:02:17.044773Z

ACCOUNT ISOLATION SAFETY CONSTRAINT for TASK-006: the operator-designated Cloudflare office account contains important unrelated projects. Before any mutation, verify the Alchemy default profile resolves to the intended account using redacted output, generate high-entropy disposable names, and perform read-only provider checks proving the exact game-host and behavior-worker names are absent. Abort on account mismatch, name collision, or ambiguous ownership. The mutation allowlist is limited to the two newly created disposable Workers and only their newly created PlaytestRoom Durable Object namespace or migration closure. Never adopt existing resources, never use alchemy nuke, wildcard or prefix deletion, and never modify existing Workers, Pages projects, routes, custom domains, KV, R2, D1, queues, certificates, DNS, or other account resources. Deploy and destroy from the exact isolated Alchemy state created by this run. If state or ownership is uncertain, stop and report the disposable names instead of broadening cleanup. Postflight must prove the exact disposable names absent and unrelated resources unchanged using redacted read-only receipts.
