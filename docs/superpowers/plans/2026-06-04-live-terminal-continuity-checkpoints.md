# Live Terminal Continuity Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unnecessary terminal replay during same-page session tab switches and make refresh recovery use a terminal snapshot before replaying only the tail.

**Architecture:** Keep Cubby's current session-as-terminal model and text WebSocket protocol. The web app will keep live `SessionView` instances mounted but inactive across same-page tab switches. The server will maintain a headless xterm mirror per live session, persist the latest serialized snapshot, and expose a small `terminal.snapshot` command used when `recovery.reconcile` returns `snapshot`.

**Tech Stack:** TypeScript, React, xterm.js, `@xterm/headless`, `@xterm/addon-serialize`, Fastify WebSocket, SQLite, Vitest, Playwright.

---

## File Map

- `e2e/app.spec.ts`: update active terminal scoping and assert tab switching does not issue a new `terminal.replay`.
- `packages/web/src/app.tsx`: render the active session plus mounted live sessions instead of a single keyed `SessionView`.
- `packages/web/src/components/session/session-view.tsx`: add `active`, gate input/focus/resize/auto-start by active state, keep live subscriptions while inactive, and handle snapshot recovery.
- `packages/web/src/components/session/terminal-recovery.ts`: validate snapshot responses.
- `packages/core/src/protocol/commands.ts`: add `terminal.snapshot`.
- `packages/core/src/types/terminal.ts`: add `TerminalSnapshotResult` and the `snapshot` recovery decision.
- `packages/server/src/terminal/terminal-snapshot-buffer.ts`: mirror output in a headless xterm and serialize the current screen.
- `packages/server/src/session/store.ts`: persist and load one snapshot row per session.
- `packages/server/src/session/manager.ts`: create/update snapshot buffers on live output and resize; choose snapshot when replay from the requested seq is too old.
- `packages/server/src/ws/handler.ts`: expose `terminal.snapshot` and update resize to keep the mirror dimensions current.

## Tasks

- [ ] **Task 1: Red test for tab-switch continuity**
  - Update the live-switch E2E to record `terminal.replay` count after initial recovery.
  - Switch to a draft tab and back to the running tab.
  - Assert the active terminal still has the original DOM marker and the replay count did not increase.
  - Run `CUBBY_MOCK_CLAUDE_PROVIDER=1 bunx playwright test e2e/app.spec.ts -g "preserves a running terminal"`.

- [ ] **Task 2: Keep live views mounted**
  - Add `active?: boolean` to `SessionView`.
  - Render active plus live sessions in `App`, with inactive views absolutely positioned and hidden.
  - Scope E2E helpers to `[data-testid="session-view"][data-active="true"]`.
  - Gate terminal input, focus, resize sends, and auto-start to active views; leave live output subscriptions enabled.
  - Re-run the Task 1 E2E and focused existing session-switch tests.

- [ ] **Task 3: Red tests for snapshots**
  - Add server snapshot buffer tests for serialization and final visible state.
  - Add store tests for upserting/loading a snapshot row.
  - Add manager/WS tests showing evicted live output reconciles to `snapshot`, `terminal.snapshot` returns the serialized state, and tail replay starts after the snapshot seq.
  - Add web recovery validator tests for `TerminalSnapshotResult`.

- [ ] **Task 4: Server snapshot implementation**
  - Add `@xterm/headless` and `@xterm/addon-serialize` to `@cubby/server`.
  - Create `HeadlessSnapshotBuffer` with `write`, `resize`, `snapshot`, and `dispose`.
  - Add `terminal_snapshots(session_id PRIMARY KEY, data, seq, cols, rows, updated_at)` schema and migration.
  - Persist a snapshot after mirrored writes settle; if the live ring buffer is too old, `recovery.reconcile` returns `snapshot` when one is available.
  - Expose `getTerminalSnapshot(sessionId)` through `terminal.snapshot`.

- [ ] **Task 5: Web snapshot recovery**
  - When reconcile returns `snapshot`, reset the xterm, request `terminal.snapshot`, write the serialized data, set `renderedSeq` to the snapshot seq, then replay only chunks newer than that seq.
  - Preserve existing replay/noop/closed/unrecoverable handling as fallback behavior.
  - Re-run web recovery unit tests and targeted E2E refresh recovery.

- [ ] **Task 6: Final verification**
  - Run focused unit tests: `bun run test -- packages/server/src/session/manager.test.ts packages/server/src/ws/handler.test.ts packages/server/src/session/store.test.ts packages/server/src/terminal/terminal-snapshot-buffer.test.ts packages/web/src/components/session/terminal-recovery.test.ts`.
  - Run targeted E2E with mock provider.
  - Run `bun run lint` and `bun run build`.
  - Start this worktree's dev server for manual testing.
