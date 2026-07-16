# Product Specification

## Problem

Adding a large asset group (around 2,000 items) to the active working palette
causes the desktop renderer to mount every palette cell and eagerly request every
thumbnail. The preview query also sends the complete palette reference list
through Electron IPC, producing repeated main-thread budget warnings and a
sidebar that appears to load indefinitely.

## Users

Tileborne creators who curate large imported tilesets or object collections in
the desktop editor.

## Requirements

- Keep every working-palette item addressable through scrolling.
- Mount only the rows in or near the visible sidebar viewport.
- Resolve preview metadata in stable, bounded on-demand windows of at most 64
  references per IPC query.
- Load animated source-pack data only for the mounted preview window.
- Preserve brush selection, labels, ordering, clear, and palette switching.
- Reuse React Query cache when a user scrolls back to an already loaded window.

## Success Criteria

- A 2,000-item palette mounts a bounded number of cells instead of 2,000.
- The initial preview request contains no more than 64 references per query.
- Offscreen thumbnail and animation data is not requested until scrolling makes
  its window relevant.
- Focused renderer tests, desktop typecheck, and a live Electron smoke path pass.
