# API And Data Model

## Objects

- Explicit pixel and tile coordinate values/conversion helpers.
- Predicted local-player transform with input sequence and authoritative baseline.
- Gameplay fire event carrying accepted tick, player, weapon, and origin/direction.

## Commands

- Sample neutral input; submit BR intent; start/freeze/resume/stop owned session.

## Events

- Authoritative weapon fired, impact, player damaged/eliminated, and session stopped.
- Reconciliation diagnostic when correction exceeds the normal tolerance.
