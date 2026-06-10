# Terminal File Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a workspace-scoped read-only file explorer launched from the terminal surface.

**Architecture:** Extend Fastify HTTP routes with workspace-root path validation and a bounded text-file endpoint. Add a React modal component that reuses those routes and is opened from `SessionView` below the terminal.

**Tech Stack:** Bun, Fastify, React, TypeScript, Vitest, lucide-react.

---

### Task 1: Server Route Coverage

**Files:**
- Modify: `packages/server/src/server.test.ts`

- [ ] **Step 1: Write failing tests**

Add route tests that create a temp workspace, browse it with `root`, reject `../`, read a text file, and reject binary content.

- [ ] **Step 2: Run tests to verify failure**

Run: `bunx vitest run packages/server/src/server.test.ts`

Expected: tests fail because `/api/file` does not exist and `/api/browse` does not enforce `root`.

### Task 2: Safe File Routes

**Files:**
- Modify: `packages/server/src/http/routes.ts`

- [ ] **Step 1: Implement workspace-scoped browse/read helpers**

Add safe path resolution, optional `root` support to `/api/browse`, and `/api/file` for bounded UTF-8 text previews.

- [ ] **Step 2: Run server tests**

Run: `bunx vitest run packages/server/src/server.test.ts`

Expected: route tests pass.

### Task 3: Web Explorer Model Coverage

**Files:**
- Create: `packages/web/src/components/workspace/file-explorer-model.test.ts`
- Create: `packages/web/src/components/workspace/file-explorer-model.ts`

- [ ] **Step 1: Write failing tests**

Cover browse response validation, file response validation, and parent path derivation.

- [ ] **Step 2: Run tests to verify failure**

Run: `bunx vitest run packages/web/src/components/workspace/file-explorer-model.test.ts`

Expected: tests fail until the model module exists.

### Task 4: File Explorer UI

**Files:**
- Create: `packages/web/src/components/workspace/file-explorer.tsx`
- Modify: `packages/web/src/components/session/session-view.tsx`

- [ ] **Step 1: Implement modal component**

Add directory loading, parent navigation, file selection, text preview, error states, and close behavior.

- [ ] **Step 2: Add terminal toolbar launcher**

Import the modal in `SessionView`, add a bottom toolbar under `TerminalView`, and pass `session.workspaceId`.

- [ ] **Step 3: Run web tests**

Run: `bunx vitest run packages/web/src/components/workspace/file-explorer-model.test.ts`

Expected: tests pass.

### Task 5: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:
```bash
bunx vitest run packages/server/src/server.test.ts packages/web/src/components/workspace/file-explorer-model.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run lint**

Run: `bun run lint`

Expected: Biome reports no errors.

- [ ] **Step 3: Run browser verification**

Run the dev server, open the app, launch File Explorer from an active session, navigate into a folder, and preview a text file.
