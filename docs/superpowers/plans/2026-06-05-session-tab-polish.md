# Session Tab Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable session rename/delete, clearer tab state, finish sound, sorted/searchable tabs, desktop sidebar resizing, terminal padding, and true-white foreground text.

**Architecture:** Keep the current WebSocket-first session model. Add durable rename/delete behavior in `SessionStore` and `SessionManager`, expose it through WebSocket and HTTP routes, then connect the React sidebar and app shell to those commands. UI-only behavior such as sorting, search, sound, and sidebar width stays in the web package with pure helpers covered by Vitest and browser flows covered by Playwright.

**Tech Stack:** Bun, Fastify, SQLite, TypeScript, React 19, Jotai, Vite, Vitest, Playwright, xterm.js, Web Audio API.

---

## File Map

- Modify `packages/core/src/protocol/commands.ts`: add `session.rename`, `session.delete`, and `session.deleted` protocol constants.
- Modify `packages/server/src/session/store.ts`: add `delete(id)` and clean dependent terminal tables.
- Modify `packages/server/src/session/store.test.ts`: verify session deletion removes session and terminal data.
- Modify `packages/server/src/session/manager.ts`: add `renameSession` and `deleteSession`, clear in-memory state, stop live processes before deleting.
- Modify `packages/server/src/session/manager.test.ts`: verify rename validation and delete behavior for draft, ended, and live sessions.
- Modify `packages/server/src/ws/handler.ts`: handle `session.rename` and `session.delete`, broadcast `session.updated` and `session.deleted`.
- Modify `packages/server/src/ws/handler.test.ts`: verify WebSocket responses and broadcasts.
- Modify `packages/server/src/http/routes.ts`: add `PATCH /api/sessions/:id` and `DELETE /api/sessions/:id`.
- Modify `packages/server/src/server.test.ts`: verify HTTP rename and delete routes.
- Create `packages/web/src/components/session/session-list-model.ts`: pure helpers for title, workspace name, search, sorting, grouping, and visible session limiting.
- Create `packages/web/src/components/session/session-list-model.test.ts`: Vitest coverage for search and sorting.
- Modify `packages/web/src/components/session/session-list.tsx`: use model helpers; add rename/delete actions and confirmation; remove workspace count.
- Modify `packages/web/src/app.tsx`: add rename/delete callbacks, handle `session.deleted`, play finish sound, persist desktop sidebar width, add drag handle.
- Modify `packages/web/src/components/session/session-view.tsx`: add terminal padding wrapper and set primary white text to `#ffffff`.
- Modify `packages/web/src/components/terminal/terminal.tsx`: update xterm theme foreground and white to `#ffffff`.
- Modify `packages/web/src/global.css`: add sidebar resize handle states and session action-button focus/hover styles.
- Modify `e2e/app.spec.ts`: add coverage for search, no count, sorting, rename, delete confirmation, sidebar drag persistence, terminal padding, and white terminal foreground.

---

## Task 1: Protocol Constants And Store Deletion

**Files:**
- Modify: `packages/core/src/protocol/commands.ts`
- Modify: `packages/server/src/session/store.ts`
- Test: `packages/server/src/session/store.test.ts`

- [ ] **Step 1: Write failing store and protocol tests**

Add these imports and tests to `packages/server/src/session/store.test.ts`:

```ts
import { WS_COMMANDS, WS_EVENTS } from '@cubby/core';
```

```ts
it('exposes session rename delete and deleted protocol constants', () => {
  expect(WS_COMMANDS.SESSION_RENAME).toBe('session.rename');
  expect(WS_COMMANDS.SESSION_DELETE).toBe('session.delete');
  expect(WS_EVENTS.SESSION_DELETED).toBe('session.deleted');
});

it('deletes a session and its terminal data', () => {
  const session = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
  store.appendTerminalOutput(session.id, { data: 'abc', seqStart: 0, seq: 3 });
  store.upsertTerminalSnapshot(session.id, {
    data: 'screen',
    seq: 6,
    cols: 80,
    rows: 24,
  });

  expect(store.delete(session.id)).toBe(true);

  expect(store.get(session.id)).toBeNull();
  expect(store.getTerminalOutputHistory(session.id)).toEqual([]);
  expect(store.getTerminalSnapshot(session.id)).toBeNull();
  expect(store.delete(session.id)).toBe(false);
});
```

- [ ] **Step 2: Run store tests and verify RED**

Run:

```bash
bunx vitest run packages/server/src/session/store.test.ts
```

Expected: FAIL because `SESSION_RENAME`, `SESSION_DELETE`, `SESSION_DELETED`, and `store.delete` do not exist.

- [ ] **Step 3: Add protocol constants**

In `packages/core/src/protocol/commands.ts`, extend the objects:

```ts
export const WS_COMMANDS = {
  SESSION_CREATE: 'session.create',
  SESSION_START: 'session.start',
  SESSION_RESUME: 'session.resume',
  SESSION_KILL: 'session.kill',
  SESSION_LIST: 'session.list',
  SESSION_GET: 'session.get',
  SESSION_RENAME: 'session.rename',
  SESSION_DELETE: 'session.delete',
  RECOVERY_RECONCILE: 'recovery.reconcile',
  TERMINAL_SUBSCRIBE: 'terminal.subscribe',
  TERMINAL_UNSUBSCRIBE: 'terminal.unsubscribe',
  TERMINAL_REPLAY: 'terminal.replay',
  TERMINAL_SNAPSHOT: 'terminal.snapshot',
  TERMINAL_INPUT: 'terminal.input',
  TERMINAL_RESIZE: 'terminal.resize',
} as const;
```

```ts
export const WS_EVENTS = {
  SESSION_STATUS: 'session.status',
  SESSION_CREATED: 'session.created',
  SESSION_UPDATED: 'session.updated',
  SESSION_DELETED: 'session.deleted',
  TERMINAL_OUTPUT: 'terminal.output',
  TERMINAL_EXIT: 'terminal.exit',
} as const;
```

- [ ] **Step 4: Implement `SessionStore.delete`**

In `packages/server/src/session/store.ts`, add this public method after `updateTitle`:

```ts
  delete(id: string): boolean {
    this.db.prepare('DELETE FROM terminal_snapshots WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM terminal_outputs WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM terminals WHERE session_id = ?').run(id);
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id) as {
      changes: number;
    };
    return result.changes > 0;
  }
```

- [ ] **Step 5: Run store tests and verify GREEN**

Run:

```bash
bunx vitest run packages/server/src/session/store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add packages/core/src/protocol/commands.ts packages/server/src/session/store.ts packages/server/src/session/store.test.ts
git commit -m "feat(server): add session delete storage"
```

---

## Task 2: SessionManager Rename And Delete

**Files:**
- Modify: `packages/server/src/session/manager.ts`
- Test: `packages/server/src/session/manager.test.ts`

- [ ] **Step 1: Write failing manager tests**

Add these tests near the existing title and lifecycle tests in `packages/server/src/session/manager.test.ts`:

```ts
it('renames a session with a trimmed explicit title', () => {
  const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

  const renamed = manager.renameSession(session.id, '  Renamed Session  ');

  expect(renamed.title).toBe('Renamed Session');
  expect(manager.getSession(session.id)?.title).toBe('Renamed Session');
});

it('rejects empty session titles when renaming', () => {
  const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

  expect(() => manager.renameSession(session.id, '   ')).toThrow('Session title is required');
});

it('rejects renaming a missing session', () => {
  expect(() => manager.renameSession('missing', 'Renamed')).toThrow('Session not found');
});

it('deletes an ended session and removes persisted output', async () => {
  const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
  store.appendTerminalOutput(session.id, { data: 'abc', seqStart: 0, seq: 3 });
  store.updateStatus(session.id, 'ended');

  await expect(manager.deleteSession(session.id)).resolves.toBe(true);

  expect(manager.getSession(session.id)).toBeNull();
  expect(manager.getOutputHistory(session.id)).toEqual([]);
});

it('stops a live process before deleting the session', async () => {
  let killed = false;
  const provider = {
    name: 'deletable-live',
    async spawn() {
      return {
        pid: 44_001,
        onData: (_callback: (data: string) => void) => {},
        onExit: (_callback: (code: number) => void) => {},
        write: () => {},
        resize: () => {},
        kill: () => {
          killed = true;
        },
      };
    },
    async kill() {},
  };
  manager.registerProvider(provider);
  const session = manager.createSession({ workspaceId: '/tmp', provider: provider.name });
  await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

  await expect(manager.deleteSession(session.id)).resolves.toBe(true);

  expect(killed).toBe(true);
  expect(manager.getProcess(session.id)).toBeUndefined();
  expect(manager.getSession(session.id)).toBeNull();
});
```

- [ ] **Step 2: Run manager tests and verify RED**

Run:

```bash
bunx vitest run packages/server/src/session/manager.test.ts
```

Expected: FAIL because `renameSession` and `deleteSession` do not exist.

- [ ] **Step 3: Add manager methods**

In `packages/server/src/session/manager.ts`, add these public methods after `getSession`:

```ts
  renameSession(sessionId: string, title: string): Session {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new Error('Session title is required');

    const session = this.store.get(sessionId);
    if (!session) throw new Error('Session not found');

    this.store.updateTitle(sessionId, trimmedTitle);
    const updated = this.store.get(sessionId);
    if (!updated) throw new Error('Session not found');
    return updated;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.store.get(sessionId);
    if (!session) return false;

    const live = session.status === 'starting' || session.status === 'running';
    const process = this.processes.get(sessionId);
    let killError: unknown;
    if (process) {
      try {
        process.kill();
      } catch (err) {
        killError = err;
      } finally {
        this.processes.delete(sessionId);
      }
    }

    this.disposeSnapshotBuffer(sessionId);
    this.outputBuffers.delete(sessionId);
    this.firstInputBuffers.delete(sessionId);
    this.sessionsNeedingResumeInputReset.delete(sessionId);

    if (live) {
      this.store.updateStatus(sessionId, 'ended', { pid: process?.pid });
      this.notifyStatusChange(sessionId, 'ended');
    }

    if (killError) throw killError;

    return this.store.delete(sessionId);
  }
```

- [ ] **Step 4: Run manager tests and verify GREEN**

Run:

```bash
bunx vitest run packages/server/src/session/manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add packages/server/src/session/manager.ts packages/server/src/session/manager.test.ts
git commit -m "feat(server): add session rename and delete manager"
```

---

## Task 3: WebSocket And HTTP Session Operations

**Files:**
- Modify: `packages/server/src/ws/handler.ts`
- Test: `packages/server/src/ws/handler.test.ts`
- Modify: `packages/server/src/http/routes.ts`
- Test: `packages/server/src/server.test.ts`

- [ ] **Step 1: Write failing WebSocket tests**

Add these tests to `packages/server/src/ws/handler.test.ts`:

```ts
it('renames a session through websocket command and broadcasts update', async () => {
  const sent: unknown[] = [];
  const ws = {
    readyState: 1,
    send: (message: string) => sent.push(JSON.parse(message)),
  } as unknown as WebSocket;
  hub.addClient(ws);
  const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

  const response = await handler.handle(ws, {
    id: 'rename-session',
    cmd: 'session.rename',
    args: { sessionId: session.id, title: '  New Name  ' },
  });

  expect(response).toEqual({
    id: 'rename-session',
    ok: true,
    data: expect.objectContaining({ id: session.id, title: 'New Name' }),
  });
  expect(sent).toContainEqual({
    evt: 'session.updated',
    data: expect.objectContaining({ id: session.id, title: 'New Name' }),
  });
});

it('deletes a session through websocket command and broadcasts deletion', async () => {
  const sent: unknown[] = [];
  const ws = {
    readyState: 1,
    send: (message: string) => sent.push(JSON.parse(message)),
  } as unknown as WebSocket;
  hub.addClient(ws);
  const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });

  const response = await handler.handle(ws, {
    id: 'delete-session',
    cmd: 'session.delete',
    args: { sessionId: session.id },
  });

  expect(response).toEqual({ id: 'delete-session', ok: true, data: { sessionId: session.id } });
  expect(manager.getSession(session.id)).toBeNull();
  expect(sent).toContainEqual({
    evt: 'session.deleted',
    data: { sessionId: session.id },
  });
});
```

- [ ] **Step 2: Write failing HTTP route tests**

Add tests to `packages/server/src/server.test.ts`:

```ts
it('renames a session through HTTP patch', async () => {
  const session = store.create({ workspaceId: '/tmp', provider: 'claude-code', title: 'Old' });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/sessions/${session.id}`,
    payload: { title: 'HTTP Renamed' },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ id: session.id, title: 'HTTP Renamed' });
  expect(store.get(session.id)?.title).toBe('HTTP Renamed');
});

it('deletes a session through HTTP delete', async () => {
  const session = store.create({ workspaceId: '/tmp', provider: 'claude-code', title: 'Delete' });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/sessions/${session.id}`,
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ok: true, sessionId: session.id });
  expect(store.get(session.id)).toBeNull();
});
```

- [ ] **Step 3: Run server tests and verify RED**

Run:

```bash
bunx vitest run packages/server/src/ws/handler.test.ts packages/server/src/server.test.ts
```

Expected: FAIL because the handlers and routes are not implemented.

- [ ] **Step 4: Implement WebSocket handlers**

In `packages/server/src/ws/handler.ts`, add switch cases:

```ts
        case WS_COMMANDS.SESSION_RENAME:
          return this.sessionRename(request);
        case WS_COMMANDS.SESSION_DELETE:
          return this.sessionDelete(request);
```

Add methods near `sessionGet`:

```ts
  private sessionRename(req: WSRequest): WSResponse {
    const { sessionId, title } = req.args as { sessionId: string; title: string };
    const session = this.sessionManager.renameSession(sessionId, title);
    this.hub.broadcastToAll({ evt: WS_EVENTS.SESSION_UPDATED, data: session });
    return { id: req.id, ok: true, data: session };
  }

  private async sessionDelete(req: WSRequest): Promise<WSResponse> {
    const { sessionId } = req.args as { sessionId: string };
    const deleted = await this.sessionManager.deleteSession(sessionId);
    if (!deleted) {
      return { id: req.id, ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } };
    }
    this.hub.broadcastToAll({ evt: WS_EVENTS.SESSION_DELETED, data: { sessionId } });
    return { id: req.id, ok: true, data: { sessionId } };
  }
```

- [ ] **Step 5: Implement HTTP routes**

In `packages/server/src/http/routes.ts`, add routes after `POST /api/sessions`:

```ts
  app.patch('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { title?: string } | undefined;
    try {
      return sessionManager.renameSession(id, body?.title ?? '');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(message === 'Session not found' ? 404 : 400);
      return { error: message };
    }
  });

  app.delete('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await sessionManager.deleteSession(id);
    if (!deleted) {
      reply.code(404);
      return { error: 'Session not found' };
    }
    return { ok: true, sessionId: id };
  });
```

- [ ] **Step 6: Run server tests and verify GREEN**

Run:

```bash
bunx vitest run packages/server/src/ws/handler.test.ts packages/server/src/server.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add packages/server/src/ws/handler.ts packages/server/src/ws/handler.test.ts packages/server/src/http/routes.ts packages/server/src/server.test.ts
git commit -m "feat(server): expose session rename and delete"
```

---

## Task 4: Session List Model Helpers

**Files:**
- Create: `packages/web/src/components/session/session-list-model.ts`
- Create: `packages/web/src/components/session/session-list-model.test.ts`
- Modify: `packages/web/src/components/session/session-list.tsx`

- [ ] **Step 1: Write failing helper tests**

Create `packages/web/src/components/session/session-list-model.test.ts`:

```ts
import type { Session } from '@cubby/core';
import { describe, expect, it } from 'vitest';
import {
  groupSessions,
  matchesSessionSearch,
  sortSessionsForWorkspace,
  visibleSessions,
  workspaceName,
} from './session-list-model.js';

function session(input: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    id: input.id,
    workspaceId: input.workspaceId ?? '/tmp/project',
    title: input.title ?? null,
    provider: input.provider ?? 'claude-code',
    model: input.model ?? null,
    status: input.status ?? 'draft',
    pid: input.pid ?? null,
    exitCode: input.exitCode ?? null,
    createdAt: input.createdAt ?? '2026-06-05T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-06-05T00:00:00.000Z',
    endedAt: input.endedAt ?? null,
  };
}

describe('session-list-model', () => {
  it('derives workspace name from paths', () => {
    expect(workspaceName('/tmp/cubby')).toBe('cubby');
    expect(workspaceName('C:\\Users\\me\\cubby')).toBe('cubby');
  });

  it('matches provider searches even when title is custom', () => {
    const item = session({ id: 's1', title: 'Custom Name', provider: 'claude-code' });

    expect(matchesSessionSearch(item, 'claude-code')).toBe(true);
    expect(matchesSessionSearch(item, 'custom')).toBe(true);
    expect(matchesSessionSearch(item, 'missing')).toBe(false);
  });

  it('sorts active session first then by updated and created timestamps', () => {
    const older = session({
      id: 'older',
      updatedAt: '2026-06-05T00:00:00.000Z',
      createdAt: '2026-06-05T00:00:00.000Z',
    });
    const active = session({
      id: 'active',
      updatedAt: '2026-06-05T00:01:00.000Z',
      createdAt: '2026-06-05T00:01:00.000Z',
    });
    const recent = session({
      id: 'recent',
      updatedAt: '2026-06-05T00:02:00.000Z',
      createdAt: '2026-06-05T00:02:00.000Z',
    });

    expect(sortSessionsForWorkspace([older, active, recent], 'active').map((item) => item.id)).toEqual([
      'active',
      'recent',
      'older',
    ]);
  });

  it('groups sessions after sorting input order is provided', () => {
    const groups = groupSessions([
      session({ id: 'a', workspaceId: '/tmp/a' }),
      session({ id: 'b', workspaceId: '/tmp/b' }),
      session({ id: 'a2', workspaceId: '/tmp/a' }),
    ]);

    expect(groups).toEqual([
      { workspaceId: '/tmp/a', sessions: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'a2' })] },
      { workspaceId: '/tmp/b', sessions: [expect.objectContaining({ id: 'b' })] },
    ]);
  });

  it('keeps active session visible when limiting visible sessions', () => {
    const items = Array.from({ length: 7 }, (_, index) => session({ id: `s${index}` }));

    expect(visibleSessions(items, 's6').map((item) => item.id)).toEqual([
      's6',
      's0',
      's1',
      's2',
      's3',
    ]);
  });
});
```

- [ ] **Step 2: Run helper tests and verify RED**

Run:

```bash
bunx vitest run packages/web/src/components/session/session-list-model.test.ts
```

Expected: FAIL because `session-list-model.ts` does not exist.

- [ ] **Step 3: Implement helper module**

Create `packages/web/src/components/session/session-list-model.ts`:

```ts
import type { Session } from '@cubby/core';

export interface WorkspaceGroup {
  workspaceId: string;
  sessions: Session[];
}

export const VISIBLE_SESSION_LIMIT = 5;

export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function workspaceName(workspaceId: string): string {
  const parts = workspaceId.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? workspaceId;
}

export function sessionTitle(session: Session): string {
  return session.title ?? session.provider;
}

export function matchesSessionSearch(session: Session, query: string): boolean {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  const values = [
    sessionTitle(session),
    session.provider,
    session.workspaceId,
    workspaceName(session.workspaceId),
    session.status,
    session.id,
  ];
  return values.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function sortSessionsForWorkspace(
  sessions: Session[],
  currentId: string | null,
): Session[] {
  return [...sessions].sort((left, right) => {
    if (left.id === currentId && right.id !== currentId) return -1;
    if (right.id === currentId && left.id !== currentId) return 1;
    const updatedDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (updatedDelta !== 0) return updatedDelta;
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

export function groupSessions(sessions: Session[]): WorkspaceGroup[] {
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const group = groups.get(session.workspaceId);
    if (group) {
      group.push(session);
    } else {
      groups.set(session.workspaceId, [session]);
    }
  }
  return Array.from(groups, ([workspaceId, group]) => ({ workspaceId, sessions: group }));
}

export function visibleSessions(groupSessions: Session[], currentId: string | null): Session[] {
  if (groupSessions.length <= VISIBLE_SESSION_LIMIT) return groupSessions;

  const defaultVisible = groupSessions.slice(0, VISIBLE_SESSION_LIMIT);
  const current = currentId ? groupSessions.find((session) => session.id === currentId) : null;
  if (!current || defaultVisible.some((session) => session.id === current.id))
    return defaultVisible;

  return [
    current,
    ...groupSessions
      .filter((session) => session.id !== current.id)
      .slice(0, VISIBLE_SESSION_LIMIT - 1),
  ];
}
```

- [ ] **Step 4: Run helper tests and verify GREEN**

Run:

```bash
bunx vitest run packages/web/src/components/session/session-list-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire helpers into SessionList**

In `packages/web/src/components/session/session-list.tsx`, remove local definitions of `VISIBLE_SESSION_LIMIT`, `WorkspaceGroup`, `normalizeSearch`, `workspaceName`, `groupSessions`, `visibleSessions`, `sessionTitle`, and `matchesSessionSearch`.

Add imports:

```ts
import {
  groupSessions,
  matchesSessionSearch,
  normalizeSearch,
  sessionTitle,
  sortSessionsForWorkspace,
  visibleSessions,
  workspaceName,
} from './session-list-model.js';
```

Replace the `groups` calculation:

```ts
  const groups = useMemo(
    () =>
      groupSessions(filteredSessions).map((group) => ({
        ...group,
        sessions: sortSessionsForWorkspace(group.sessions, currentId),
      })),
    [filteredSessions, currentId],
  );
```

- [ ] **Step 6: Run helper and web type build**

Run:

```bash
bunx vitest run packages/web/src/components/session/session-list-model.test.ts
bun run --filter @cubby/web build
```

Expected: both commands PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add packages/web/src/components/session/session-list-model.ts packages/web/src/components/session/session-list-model.test.ts packages/web/src/components/session/session-list.tsx
git commit -m "feat(web): model session list search and sorting"
```

---

## Task 5: App State, Deleted Event, Finish Sound, And Sidebar Resize

**Files:**
- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/global.css`

- [ ] **Step 1: Add app helpers before component code**

In `packages/web/src/app.tsx`, add constants near sidebar constants:

```ts
const SIDEBAR_WIDTH_STORAGE_KEY = 'cubby.sidebarWidth';
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 420;
```

Add helper functions after `persistCurrentSessionId`:

```ts
function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function initialSidebarWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_EXPANDED_WIDTH;
  const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored)) return SIDEBAR_EXPANDED_WIDTH;
  return clampSidebarWidth(stored);
}

function isSessionDeletedData(value: unknown): value is { sessionId: string } {
  return isRecord(value) && typeof value.sessionId === 'string';
}

function playSessionFinishedSound(): void {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const first = context.createOscillator();
  const second = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;

  first.type = 'sine';
  first.frequency.setValueAtTime(660, now);
  second.type = 'triangle';
  second.frequency.setValueAtTime(990, now + 0.08);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

  first.connect(gain);
  second.connect(gain);
  gain.connect(context.destination);
  first.start(now);
  first.stop(now + 0.16);
  second.start(now + 0.07);
  second.stop(now + 0.28);
  window.setTimeout(() => void context.close(), 380);
}
```

Add this global typing near imports if TypeScript needs it:

```ts
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
```

- [ ] **Step 2: Add state and refs in `App`**

Update the React import:

```ts
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

Inside `App`, add:

```ts
  const [desktopSidebarWidth, setDesktopSidebarWidth] = useState(initialSidebarWidth);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const previousSessionStatusesRef = useRef<Map<string, SessionStatus> | null>(null);
```

Update `sidebarWidth`:

```ts
  const sidebarWidth = sidebarCollapsed
    ? '0px'
    : mobileLayout
      ? `min(${MOBILE_SIDEBAR_WIDTH}px, calc(100vw - 48px))`
      : `${desktopSidebarWidth}px`;
```

- [ ] **Step 3: Handle finish sound transitions**

Add this effect after `mountedSessions`:

```ts
  useEffect(() => {
    const previous = previousSessionStatusesRef.current;
    const next = new Map(sessions.map((session) => [session.id, session.status]));

    if (previous) {
      for (const session of sessions) {
        const oldStatus = previous.get(session.id);
        if (
          (oldStatus === 'starting' || oldStatus === 'running') &&
          session.status === 'ended'
        ) {
          try {
            playSessionFinishedSound();
          } catch {}
        }
      }
    }

    previousSessionStatusesRef.current = next;
  }, [sessions]);
```

- [ ] **Step 4: Handle deleted event and preferred reselection**

In the `onMessage` effect, add after `session.updated` handling:

```ts
      if ('evt' in msg && msg.evt === 'session.deleted' && isSessionDeletedData(msg.data)) {
        const deletedId = msg.data.sessionId;
        setSessions((prev) => {
          const next = prev.filter((session) => session.id !== deletedId);
          if (currentId === deletedId) {
            const nextId = preferredSessionId(next);
            setCurrentId(nextId);
            persistCurrentSessionId(nextId);
          }
          return next;
        });
        setPendingSession((pending) => (pending?.id === deletedId ? null : pending));
        setMountedSessionIds((prev) => {
          if (!prev.has(deletedId)) return prev;
          const next = new Set(prev);
          next.delete(deletedId);
          return next;
        });
      }
```

- [ ] **Step 5: Add rename and delete callbacks**

In `App`, add callbacks near `handleSelectSession`:

```ts
  const handleRenameSession = useCallback(
    async (id: string, title: string) => {
      const res = await request({
        id: `rename-${Date.now()}`,
        cmd: 'session.rename',
        args: { sessionId: id, title },
      });
      if (!res.ok || !isSession(res.data)) return false;
      setSessions((prev) => prev.map((session) => (session.id === id ? res.data : session)));
      setPendingSession((pending) => (pending?.id === id ? res.data : pending));
      return true;
    },
    [request, setSessions],
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const res = await request({
        id: `delete-${Date.now()}`,
        cmd: 'session.delete',
        args: { sessionId: id },
      });
      if (!res.ok) return false;
      const nextSessions = sessions.filter((session) => session.id !== id);
      setSessions(nextSessions);
      setPendingSession((pending) => (pending?.id === id ? null : pending));
      setMountedSessionIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (currentId === id) {
        const nextId = preferredSessionId(nextSessions);
        setCurrentId(nextId);
        persistCurrentSessionId(nextId);
      }
      return true;
    },
    [request, sessions, currentId, setSessions, setCurrentId],
  );
```

Pass these props to `SessionList`:

```tsx
                onRename={handleRenameSession}
                onDelete={handleDeleteSession}
```

- [ ] **Step 6: Add desktop sidebar drag behavior**

Add callback in `App`:

```ts
  const handleSidebarResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (mobileLayout || sidebarCollapsed) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      setSidebarDragging(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setDesktopSidebarWidth(clampSidebarWidth(moveEvent.clientX));
      };
      const handlePointerUp = (upEvent: PointerEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        setSidebarDragging(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [mobileLayout, sidebarCollapsed],
  );
```

Add persistence effect:

```ts
  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(desktopSidebarWidth));
  }, [desktopSidebarWidth]);
```

Inside `sidebar-shell`, after the inner `SessionList` wrapper, render:

```tsx
          {!sidebarCollapsed && !mobileLayout && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              data-testid="sidebar-resize-handle"
              className={`sidebar-resize-handle ${sidebarDragging ? 'is-dragging' : ''}`}
              onPointerDown={handleSidebarResizePointerDown}
            />
          )}
```

- [ ] **Step 7: Add resize handle CSS**

In `packages/web/src/global.css`, add:

```css
.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: -4px;
  bottom: 0;
  z-index: 2;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}

.sidebar-resize-handle::after {
  position: absolute;
  top: 0;
  right: 3px;
  bottom: 0;
  width: 1px;
  background: transparent;
  content: "";
}

.sidebar-resize-handle:hover::after,
.sidebar-resize-handle.is-dragging::after {
  background: #ffffff;
}

body:has(.sidebar-resize-handle.is-dragging) {
  user-select: none;
  cursor: col-resize;
}
```

- [ ] **Step 8: Run web build**

Run:

```bash
bun run --filter @cubby/web build
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

Run:

```bash
git add packages/web/src/app.tsx packages/web/src/global.css
git commit -m "feat(web): handle session deletion and sidebar resize"
```

---

## Task 6: SessionList Rename/Delete UI And Count Removal

**Files:**
- Modify: `packages/web/src/components/session/session-list.tsx`
- Modify: `packages/web/src/global.css`

- [ ] **Step 1: Update props and imports**

In `packages/web/src/components/session/session-list.tsx`, update lucide imports:

```ts
import {
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
```

Extend `SessionListProps`:

```ts
  onRename: (id: string, title: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
```

Add state inside `SessionList`:

```ts
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [openActionsSessionId, setOpenActionsSessionId] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
```

- [ ] **Step 2: Add submit and delete handlers**

Inside `SessionList`, add:

```ts
  const beginRename = (session: Session) => {
    setOpenActionsSessionId(null);
    setEditingSessionId(session.id);
    setEditingTitle(sessionTitle(session));
  };

  const submitRename = async (sessionId: string) => {
    const trimmedTitle = editingTitle.trim();
    if (!trimmedTitle) return;
    setBusySessionId(sessionId);
    const renamed = await onRename(sessionId, trimmedTitle);
    setBusySessionId(null);
    if (renamed) {
      setEditingSessionId(null);
      setEditingTitle('');
    }
  };

  const confirmDelete = async (session: Session) => {
    setOpenActionsSessionId(null);
    const live = isLiveStatus(session.status);
    const confirmed = window.confirm(
      live
        ? `Delete "${sessionTitle(session)}"? This will stop the running session.`
        : `Delete "${sessionTitle(session)}"?`,
    );
    if (!confirmed) return;
    setBusySessionId(session.id);
    const deleted = await onDelete(session.id);
    setBusySessionId((current) => (current === session.id ? null : current));
    if (deleted && editingSessionId === session.id) {
      setEditingSessionId(null);
      setEditingTitle('');
    }
  };
```

- [ ] **Step 3: Remove workspace count**

Delete the trailing count `<span>` inside the workspace tab button. Change its grid to one column:

```ts
                    gridTemplateColumns: 'minmax(0, 1fr)',
```

Remove `hasLiveSession` if it is only used by the deleted count.

- [ ] **Step 4: Convert session rows to containers with a primary select target**

The current session row is a `<button>`. Convert it to a `<div data-testid="session-item">` so the row can contain rename/delete buttons without nesting interactive controls inside another button. Use the same outer visual styles currently applied to the button, keep `onClick={() => onSelect(session.id)}` on the container for existing tests that click the row, and add a child primary button for accessible selection:

```tsx
                      <div
                        key={session.id}
                        data-testid="session-item"
                        onClick={() => onSelect(session.id)}
                        style={{
                          position: 'relative',
                          overflow: 'visible',
                          padding: '10px 10px 10px 13px',
                          cursor: 'pointer',
                          background: active ? tone.background : '#141414',
                          borderRadius: '6px',
                          marginBottom: '7px',
                          border: `1px solid ${active ? tone.activeBorder : tone.border}`,
                          color: tone.text,
                          width: '100%',
                          textAlign: 'left',
                          boxShadow: active
                            ? `inset 3px 0 0 ${tone.indicator}, inset 0 0 0 1px rgba(255,255,255,0.04)`
                            : 'inset 3px 0 0 #2d2d2a',
                        }}
                      >
                        <button
                          type="button"
                          aria-label={`Session ${sessionTitle(session)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(session.id);
                          }}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            border: 0,
                            background: 'transparent',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        />
                        <div style={{ position: 'relative', zIndex: 1 }}>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'minmax(0, 1fr) auto',
                              gap: '8px',
                              alignItems: 'center',
                              fontWeight: 650,
                              fontSize: '13px',
                              overflow: 'hidden',
                            }}
                          >
                            <span
                              style={{
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <SessionTitle session={session} fontSize="13px" />
                            </span>
                            <span
                              className="session-status-dot"
                              data-live={liveSession ? 'true' : 'false'}
                              aria-hidden="true"
                              title={statusLabel(session.status)}
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '999px',
                                background: tone.indicator,
                                boxShadow: liveSession
                                  ? `0 0 0 3px rgba(143, 191, 115, 0.13)`
                                  : 'none',
                              }}
                            />
                          </div>
                        </div>
                      </div>
```

The primary button gives `getByRole('button', { name: "Session ..." })` a stable target. Every rename/delete control must call `event.stopPropagation()` so the row is not selected when opening actions, typing, saving, cancelling, or deleting.

- [ ] **Step 5: Replace session row title with edit mode and action button**

Within each visible `session` map, place this structure inside the `position: relative` content wrapper from Step 4:

```tsx
                        {editingSessionId === session.id ? (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void submitRename(session.id);
                            }}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                              gap: '4px',
                              alignItems: 'center',
                            }}
                          >
                            <input
                              aria-label={`Rename ${sessionTitle(session)}`}
                              value={editingTitle}
                              disabled={busySessionId === session.id}
                              onChange={(event) => setEditingTitle(event.target.value)}
                              onClick={(event) => event.stopPropagation()}
                              style={{
                                minWidth: 0,
                                height: '26px',
                                border: '1px solid #3a3a36',
                                borderRadius: '5px',
                                background: '#080909',
                                color: '#ffffff',
                                padding: '0 7px',
                                fontSize: '12px',
                              }}
                            />
                            <button
                              type="submit"
                              aria-label="Save session name"
                              disabled={!editingTitle.trim() || busySessionId === session.id}
                              className="session-icon-action"
                            >
                              <Check size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label="Cancel rename"
                              className="session-icon-action"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingSessionId(null);
                                setEditingTitle('');
                              }}
                            >
                              <X size={14} aria-hidden="true" />
                            </button>
                          </form>
                        ) : (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                              gap: '6px',
                              alignItems: 'center',
                            }}
                          >
                            <span
                              style={{
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <SessionTitle session={session} fontSize="13px" />
                            </span>
                            <span
                              className="session-status-dot"
                              data-live={liveSession ? 'true' : 'false'}
                              aria-hidden="true"
                              title={statusLabel(session.status)}
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '999px',
                                background: tone.indicator,
                                boxShadow: liveSession
                                  ? `0 0 0 3px rgba(143, 191, 115, 0.13)`
                                  : 'none',
                              }}
                            />
                            <span style={{ position: 'relative' }}>
                              <button
                                type="button"
                                aria-label={`Session actions for ${sessionTitle(session)}`}
                                className="session-icon-action"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenActionsSessionId((prev) =>
                                    prev === session.id ? null : session.id,
                                  );
                                }}
                              >
                                <MoreHorizontal size={14} aria-hidden="true" />
                              </button>
                              {openActionsSessionId === session.id && (
                                <span className="session-actions-menu">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      beginRename(session);
                                    }}
                                  >
                                    <Pencil size={13} aria-hidden="true" />
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void confirmDelete(session);
                                    }}
                                  >
                                    <Trash2 size={13} aria-hidden="true" />
                                    Delete
                                  </button>
                                </span>
                              )}
                            </span>
                          </div>
                        )}
```

Apply the same action menu to `session-more-item` rows by using `beginRename(session)` and `confirmDelete(session)` in the overflow menu. The overflow row can remain a button only if it does not render the action controls; if action controls are rendered there, convert it to the same container pattern used for visible rows.

- [ ] **Step 6: Add CSS for action controls**

In `packages/web/src/global.css`, add:

```css
.session-icon-action {
  width: 24px;
  height: 24px;
  border: 1px solid #2f302d;
  border-radius: 5px;
  background: #101111;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
}

.session-icon-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.session-actions-menu {
  position: absolute;
  top: 28px;
  right: 0;
  z-index: 5;
  min-width: 118px;
  border: 1px solid #30302c;
  border-radius: 6px;
  background: #090a0a;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
  padding: 4px;
}

.session-actions-menu button {
  width: 100%;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #ffffff;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: left;
}

.session-actions-menu button:hover {
  background: #171818;
}
```

- [ ] **Step 7: Run web build**

Run:

```bash
bun run --filter @cubby/web build
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

Run:

```bash
git add packages/web/src/components/session/session-list.tsx packages/web/src/global.css
git commit -m "feat(web): add session rename and delete controls"
```

---

## Task 7: Terminal Padding And True White Text

**Files:**
- Modify: `packages/web/src/components/session/session-view.tsx`
- Modify: `packages/web/src/components/terminal/terminal.tsx`
- Modify: `packages/web/src/components/session/session-list.tsx`
- Modify: `packages/web/src/app.tsx`

- [ ] **Step 1: Update xterm theme**

In `packages/web/src/components/terminal/terminal.tsx`, update theme values:

```ts
        foreground: '#ffffff',
        white: '#ffffff',
        brightWhite: '#ffffff',
```

- [ ] **Step 2: Add terminal padding wrapper**

In `packages/web/src/components/session/session-view.tsx`, replace the terminal container section with a wrapper that keeps overlays working. The final terminal area contains this structure:

```tsx
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          background: '#050606',
          padding: '10px 12px 12px',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <TerminalView
            ref={termRef}
            fitToContainer={fitTerminalToContainer}
            interactive={active && live}
            onData={handleData}
            onResize={handleResize}
            onReady={() => setTerminalReady(true)}
          />
        </div>
        {showEmptyEndedHistory && <EmptyEndedHistory />}
        {showRecoveryError && (
          <div data-testid="terminal-recovery-error">Terminal history is no longer available</div>
        )}
      </div>
```

Preserve the existing recovery error markup and styles if it already differs; only move it inside the padded relative container.

- [ ] **Step 3: Change visible intended-white UI colors**

Replace intended-white gray values in these files:

`packages/web/src/app.tsx`:

```ts
        color: '#ffffff',
```

for the app shell primary text.

`packages/web/src/components/session/session-view.tsx`:

```ts
color: '#ffffff'
```

for `session-title`, empty history title, and primary button text where it currently uses `#dedbd2` for white.

`packages/web/src/components/session/session-list.tsx`:

```ts
color: '#ffffff'
```

for search input text, active workspace title, ended session primary text, and more-menu item text where gray-white is intended as white.

Keep muted metadata colors such as `#6f6f6a`, `#8d8d87`, and borders unchanged.

- [ ] **Step 4: Run build**

Run:

```bash
bun run --filter @cubby/web build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

Run:

```bash
git add packages/web/src/components/session/session-view.tsx packages/web/src/components/terminal/terminal.tsx packages/web/src/components/session/session-list.tsx packages/web/src/app.tsx
git commit -m "fix(web): pad terminal and use true white text"
```

---

## Task 8: E2E Coverage And Full Verification

**Files:**
- Modify: `e2e/app.spec.ts`

- [ ] **Step 1: Add E2E helper for style metrics**

Add helper near existing terminal helpers:

```ts
async function terminalPaneMetrics(page: Page): Promise<{
  paneLeft: number;
  terminalLeft: number;
  terminalRight: number;
  paneRight: number;
  foreground: string;
}> {
  return activeSessionView(page).evaluate((view) => {
    const pane = view.querySelector('.xterm')?.parentElement?.parentElement;
    const terminal = view.querySelector('.xterm');
    const rows = view.querySelector('.xterm-rows');
    if (!pane || !terminal || !rows) {
      throw new Error('Terminal metrics unavailable');
    }
    const paneRect = pane.getBoundingClientRect();
    const terminalRect = terminal.getBoundingClientRect();
    return {
      paneLeft: paneRect.left,
      terminalLeft: terminalRect.left,
      terminalRight: terminalRect.right,
      paneRight: paneRect.right,
      foreground: getComputedStyle(rows).color,
    };
  });
}
```

- [ ] **Step 2: Add search, count, and sorting tests**

Add tests after `session list shows sessions`:

```ts
test('session search filters by provider and workspace count is hidden', async ({ page }) => {
  const stamp = Date.now();
  const workspaceId = `/tmp/cubby-search-provider-${stamp}`;
  await createSession(page, { workspaceId, title: `Provider Search ${stamp}` });

  await page.goto('/');
  const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
  await page.getByLabel('Search sessions').fill('claude-code');

  await expect(group.getByTestId('session-item')).toHaveCount(1);
  await expect(group.getByTestId('workspace-tab')).not.toContainText(/^1$/);
});

test('active session is sorted before a newer inactive session', async ({ page }) => {
  const stamp = Date.now();
  const workspaceId = `/tmp/cubby-active-sort-${stamp}`;
  const older = await createSession(page, { workspaceId, title: `Active Sort Older ${stamp}` });
  const newer = await createSession(page, { workspaceId, title: `Active Sort Newer ${stamp}` });

  await page.goto('/');
  const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
  await selectSessionTab(group, older.title);

  await expect(group.getByTestId('session-item').first()).toContainText(older.title);
  await expect(group.getByTestId('session-item').nth(1)).toContainText(newer.title);
});
```

- [ ] **Step 3: Add rename and delete tests**

Add:

```ts
test('renames a session and persists after reload', async ({ page }) => {
  const stamp = Date.now();
  const workspaceId = `/tmp/cubby-rename-${stamp}`;
  const session = await createSession(page, { workspaceId, title: `Rename Before ${stamp}` });
  const renamed = `Rename After ${stamp}`;

  await page.goto('/');
  const item = page.getByTestId('session-item').filter({ hasText: session.title });
  await item.getByRole('button', { name: `Session actions for ${session.title}` }).click();
  await item.getByRole('button', { name: 'Rename' }).click();
  await item.getByLabel(`Rename ${session.title}`).fill(renamed);
  await item.getByRole('button', { name: 'Save session name' }).click();

  await expect(page.getByTestId('session-item').filter({ hasText: renamed })).toHaveCount(1);
  await expect(page.getByTestId('app-header')).toContainText(renamed);

  await page.reload();
  await expect(page.getByTestId('session-item').filter({ hasText: renamed })).toHaveCount(1);
});

test('deletes a running session only after confirmation', async ({ page }) => {
  test.skip(
    !MOCK_CLAUDE_PROVIDER_ENABLED,
    'Requires CUBBY_MOCK_CLAUDE_PROVIDER=1 to start and delete a deterministic running session',
  );

  const stamp = Date.now();
  const workspaceId = `/tmp/cubby-delete-running-${stamp}`;
  const session = await createSession(page, { workspaceId, title: `Delete Running ${stamp}` });
  await startSession(page, session);

  await page.goto('/');
  await assertActiveDetail(page, { title: session.title, status: 'running', action: 'Stop' });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('This will stop the running session');
    await dialog.dismiss();
  });
  let item = page.getByTestId('session-item').filter({ hasText: session.title });
  await item.getByRole('button', { name: `Session actions for ${session.title}` }).click();
  await item.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('session-item').filter({ hasText: session.title })).toHaveCount(1);

  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  item = page.getByTestId('session-item').filter({ hasText: session.title });
  await item.getByRole('button', { name: `Session actions for ${session.title}` }).click();
  await item.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByTestId('session-item').filter({ hasText: session.title })).toHaveCount(0);
  const response = await page.request.get(`/api/sessions/${session.id}`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ error: 'Not found' });
});
```

- [ ] **Step 4: Add sidebar drag and terminal style tests**

Add:

```ts
test('desktop sidebar can be resized and persists width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');

  const sidebar = page.getByTestId('sidebar-shell');
  const handle = page.getByTestId('sidebar-resize-handle');
  await expect(sidebar).toHaveCSS('width', '240px');

  await handle.dragTo(page.locator('body'), {
    targetPosition: { x: 320, y: 300 },
  });
  await expect(sidebar).toHaveCSS('width', '320px');

  await page.reload();
  await expect(page.getByTestId('sidebar-shell')).toHaveCSS('width', '320px');
});

test('terminal pane has padding and xterm foreground is white', async ({ page }) => {
  const stamp = Date.now();
  const workspaceId = `/tmp/cubby-terminal-padding-${stamp}`;
  await createSession(page, { workspaceId, title: `Terminal Padding ${stamp}` });

  await page.goto('/');
  const metrics = await terminalPaneMetrics(page);

  expect(metrics.terminalLeft - metrics.paneLeft).toBeGreaterThanOrEqual(10);
  expect(metrics.paneRight - metrics.terminalRight).toBeGreaterThanOrEqual(10);
  expect(metrics.foreground).toBe('rgb(255, 255, 255)');
});
```

- [ ] **Step 5: Add finish sound transition test**

Add:

```ts
test('session finish sound plays on live to ended transition but not initial load', async ({
  page,
}) => {
  test.skip(
    !MOCK_CLAUDE_PROVIDER_ENABLED,
    'Requires CUBBY_MOCK_CLAUDE_PROVIDER=1 to start and stop a deterministic running session',
  );

  await page.addInitScript(() => {
    const soundWindow = window as typeof window & { __cubbySoundStarts?: number };
    soundWindow.__cubbySoundStarts = 0;

    class FakeAudioNode {
      connect() {}
    }

    class FakeOscillator extends FakeAudioNode {
      type = 'sine';
      frequency = { setValueAtTime: () => {} };
      start() {
        soundWindow.__cubbySoundStarts = (soundWindow.__cubbySoundStarts ?? 0) + 1;
      }
      stop() {}
    }

    class FakeGain extends FakeAudioNode {
      gain = {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      };
    }

    class FakeAudioContext {
      currentTime = 0;
      destination = new FakeAudioNode();
      createOscillator() {
        return new FakeOscillator();
      }
      createGain() {
        return new FakeGain();
      }
      close() {
        return Promise.resolve();
      }
    }

    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  });

  const stamp = Date.now();
  const workspaceId = `/tmp/cubby-finish-sound-${stamp}`;
  const session = await createSession(page, { workspaceId, title: `Finish Sound ${stamp}` });
  await startSession(page, session);

  await page.goto('/');
  await assertActiveDetail(page, { title: session.title, status: 'running', action: 'Stop' });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __cubbySoundStarts?: number }).__cubbySoundStarts ?? 0))
    .toBe(0);

  await stopSession(page, session);
  await assertActiveDetail(page, { title: session.title, status: 'ended', action: 'Resume' });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __cubbySoundStarts?: number }).__cubbySoundStarts ?? 0))
    .toBeGreaterThan(0);
});
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
bunx vitest run packages/server/src/session/store.test.ts packages/server/src/session/manager.test.ts packages/server/src/ws/handler.test.ts packages/server/src/server.test.ts packages/web/src/components/session/session-list-model.test.ts
CUBBY_MOCK_CLAUDE_PROVIDER=1 bun run test:e2e -- e2e/app.spec.ts
```

Expected: both commands PASS.

- [ ] **Step 7: Run full verification**

Run:

```bash
bun run lint
bun run test
bun run build
```

Expected: all commands PASS.

- [ ] **Step 8: Commit Task 8**

Run:

```bash
git add e2e/app.spec.ts
git commit -m "test(e2e): cover session tab polish"
```

---

## Final Verification Checklist

- [ ] `bun run lint` passes.
- [ ] `bun run test` passes.
- [ ] `bun run build` passes.
- [ ] `CUBBY_MOCK_CLAUDE_PROVIDER=1 bun run test:e2e -- e2e/app.spec.ts` passes.
- [ ] `git status --short` shows no uncommitted implementation changes.
