# UX Flows

## Primary Flow

1. Creator imports/selects assets and resolves redistribution diagnostics.
2. Creator imports music/SFX, previews them, and binds typed shell/game events.
3. Creator opens Game Shell, selects plugin defaults, applies project branding, edits screens/actions, and previews keyboard/gamepad flow.
4. Creator configures Single/Multiplayer and validates the mode's neutral capability support.
5. Creator playtests title -> lobby -> match -> pause/settings -> results -> retry/back.
6. Ship validates once, builds one artifact, then runs locally or plans/deploys through Alchemy.
7. Creator opens the healthy endpoint, inspects receipt/logs, and can explicitly destroy the disposable deployment.

## Empty States

- Audio: explain supported files and offer Import/Use bundled sample.
- Shell: offer accessible neutral template or mode-provided template.
- Multiplayer: explain unsupported mode/capability and link to plugin docs.
- Deployment: keep Local selected; explain how to configure Alchemy/provider credentials without storing them.

## Error States

- Every license/audio/shell/multiplayer/deploy error names the owner, impact, and next action.
- Failed imports/saves/deploys preserve prior valid state and retry context.
- Secret-like values are always redacted; users are never asked to paste secrets into project fields.
- Destroy and destructive replacement require explicit confirmation and show the exact target.
