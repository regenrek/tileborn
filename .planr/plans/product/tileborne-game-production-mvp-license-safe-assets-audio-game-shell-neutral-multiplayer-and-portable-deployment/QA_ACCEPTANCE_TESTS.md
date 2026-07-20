# QA Acceptance Tests

## Acceptance

- Fresh-profile no-JSON authoring of licensed assets, audio, shell, and deployment settings.
- Audible music plus weapon/item/environment/result SFX in editor and copied artifact.
- Complete keyboard/gamepad title-to-results flow.
- BR plus a second mode pass the same multiplayer host/join/ready/reconnect/results contract.
- Local artifact boots outside the workspace; an absent disposable target is created through Alchemy v2 and serves health, game, room, authoritative behavior, and two-client flow before verified cleanup.

## Regression

- Existing BR creator, behavior runtime, 2,000-asset, persistence/recovery, Ship, packaged smoke, and release gates remain green.
- Unknown license, broken audio ref, invalid shell action, participant host-stop attempt, leaked credential, and provider failure all fail safely.
- Boundary tests prevent BR/vendor/runtime/renderer ownership inversions.
- Adapter tests cover Alchemy v2 first-create, typed Worker-not-found handling, adopt/redeploy, remote state, redaction, partial multi-Worker failure, and idempotent destroy.

## Manual Scenarios

- Replace an unlicensed asset and watch readiness recover.
- Author bindings and verify audible feedback without raw ids.
- Navigate every required shell screen with keyboard and gamepad, including pause/back/retry.
- Run host and guest through finish/reconnect/leave semantics.
- Plan and deploy to a disposable user-owned Cloudflare target, verify real responses, inspect redacted logs, and explicitly clean it up.

## Goal Oracle

The complete scenario in README must be executed from a fresh profile and clean
checkout with screenshots/receipts, exact commands, artifact hashes, endpoint
responses, cleanup evidence, and independent review.
