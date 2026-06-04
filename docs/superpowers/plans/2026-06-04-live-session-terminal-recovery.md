# Live Session Terminal Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sequence-based replay and recovery reconciliation for live Cubby sessions so tab switches, page refreshes, and WebSocket reconnects recover missing output without duplicating terminal content.

**Architecture:** Keep Cubby's current session-as-terminal model. Add sequence metadata to terminal output chunks, use `recovery.reconcile` to decide whether a live client needs `noop`, `replay`, `closed`, or `unrecoverable`, and make `SessionView` buffer live output until recovery is complete. Snapshot, binary transport, and TerminalManager extraction stay out of scope.

**Tech Stack:** TypeScript, React, xterm.js, Fastify WebSocket, SQLite via better-sqlite3/Bun adapter, Vitest, Playwright.

---

## File Map

- `packages/core/src/protocol/commands.ts`: add `recovery.reconcile` command constant.
- `packages/core/src/types/terminal.ts`: add terminal output chunk, replay result, and recovery reconcile types.
- `packages/server/src/terminal/ring-buffer.ts`: make the terminal ring buffer sequence-aware while preserving `getAll()`, `getSince()`, and `currentIndex`.
- `packages/server/src/terminal/ring-buffer.test.ts`: cover sequence replay, exact boundaries, empty buffers, and too-old detection.
- `packages/server/src/db/schema.ts`: add nullable sequence columns for new databases.
- `packages/server/src/db/index.ts`: add a safe migration for existing `terminal_outputs` tables.
- `packages/server/src/db/schema.test.ts`: assert the sequence columns are part of schema SQL.
- `packages/server/src/session/store.ts`: persist sequence metadata when available while preserving string history reads.
- `packages/server/src/session/store.test.ts`: verify sequence columns are written and old string history behavior remains intact.
- `packages/server/src/session/manager.ts`: convert provider output to sequenced chunks, expose replay and reconcile methods, and broadcast chunks to callers.
- `packages/server/src/session/manager.test.ts`: cover live replay, too-old recovery, closed recovery, and callback sequence metadata.
- `packages/server/src/ws/handler.ts`: add `recovery.reconcile`, update `terminal.replay`, and broadcast sequenced output.
- `packages/server/src/ws/handler.test.ts`: update existing replay/output tests and add recovery command tests.
- `packages/web/src/components/session/terminal-recovery.ts`: add pure helpers for parsing replay/output payloads and merging live chunks.
- `packages/web/src/components/session/terminal-recovery.test.ts`: cover helper behavior.
- `packages/web/src/components/session/session-view.tsx`: use reconcile on live mount, buffer live chunks during recovery, detect seq gaps, and retain ended replay behavior.
- `e2e/app.spec.ts`: add mock-provider live refresh/switch recovery coverage.

---

### Task 1: Core Protocol Types

**Files:**
- Modify: `packages/core/src/protocol/commands.ts`
- Modify: `packages/core/src/types/terminal.ts`

- [ ] **Step 1: Write the new core type declarations**

In `packages/core/src/types/terminal.ts`, keep existing `Terminal` and `TerminalOutput` exports, then add:

```ts
export interface TerminalOutputChunk {
  data: string;
  seqStart: number;
  seq: number;
}

export type TerminalReplayResult =
  | {
      status: 'ok';
      sessionId: string;
      chunks: TerminalOutputChunk[];
      seq: number;
    }
  | {
      status: 'too_old';
      sessionId: string;
      oldestSeq: number;
      seq: number;
    }
  | {
      status: 'unknown';
      sessionId: string;
    };

export type RecoveryReconcileResult =
  | {
      action: 'noop';
      sessionId: string;
      headSeq: number;
    }
  | {
      action: 'replay';
      sessionId: string;
      fromSeq: number;
      headSeq: number;
    }
  | {
      action: 'closed';
      sessionId: string;
      headSeq: number;
      exitCode?: number | null;
    }
  | {
      action: 'unrecoverable';
      sessionId: string;
      reason: 'too_old_no_snapshot' | 'unknown_session';
    };
```

- [ ] **Step 2: Add the command constant**

In `packages/core/src/protocol/commands.ts`, add this property to `WS_COMMANDS` after `SESSION_GET`:

```ts
  RECOVERY_RECONCILE: 'recovery.reconcile',
```

- [ ] **Step 3: Run type-level verification**

Run:

```bash
bun run --filter @cubby/core build
```

Expected: command exits with status 0.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/protocol/commands.ts packages/core/src/types/terminal.ts
git commit -m "feat(core): add terminal recovery protocol types"
```

---

### Task 2: Sequence-Aware Ring Buffer

**Files:**
- Modify: `packages/server/src/terminal/ring-buffer.test.ts`
- Modify: `packages/server/src/terminal/ring-buffer.ts`

- [ ] **Step 1: Add failing RingBuffer tests**

Append these tests inside the existing `describe('RingBuffer', ...)` block in `packages/server/src/terminal/ring-buffer.test.ts`:

```ts
  it('returns sequenced chunks when data is pushed', () => {
    const buf = new RingBuffer(10);

    const first = buf.push('abc');
    const second = buf.push('你');

    expect(first).toEqual({ data: 'abc', seqStart: 0, seq: 3 });
    expect(second).toEqual({ data: '你', seqStart: 3, seq: 6 });
    expect(buf.currentSeq).toBe(6);
    expect(buf.oldestSeq).toBe(0);
    expect(buf.getChunks()).toEqual([first, second]);
  });

  it('replays chunks strictly after a rendered sequence', () => {
    const buf = new RingBuffer(10);
    buf.push('first');
    const second = buf.push('second');
    const third = buf.push('third');

    expect(buf.replayFrom(second.seqStart)).toEqual({
      status: 'ok',
      chunks: [second, third],
      seq: third.seq,
    });
    expect(buf.replayFrom(second.seq)).toEqual({
      status: 'ok',
      chunks: [third],
      seq: third.seq,
    });
    expect(buf.replayFrom(third.seq)).toEqual({
      status: 'ok',
      chunks: [],
      seq: third.seq,
    });
  });

  it('reports too_old when requested sequence predates retained chunks', () => {
    const buf = new RingBuffer(2);
    const first = buf.push('one');
    const second = buf.push('two');
    const third = buf.push('three');

    expect(buf.oldestSeq).toBe(second.seqStart);
    expect(buf.replayFrom(first.seqStart)).toEqual({
      status: 'too_old',
      oldestSeq: second.seqStart,
      seq: third.seq,
    });
  });
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun run test -- packages/server/src/terminal/ring-buffer.test.ts
```

Expected: FAIL with missing `currentSeq`, `oldestSeq`, `getChunks`, and `replayFrom`.

- [ ] **Step 3: Implement the sequence-aware RingBuffer**

Replace `packages/server/src/terminal/ring-buffer.ts` with:

```ts
import type { TerminalOutputChunk } from '@cubby/core';

export type RingBufferReplayResult =
  | { status: 'ok'; chunks: TerminalOutputChunk[]; seq: number }
  | { status: 'too_old'; oldestSeq: number; seq: number };

export class RingBuffer {
  private chunks: TerminalOutputChunk[];
  private maxSize: number;
  private index = 0;
  private seq = 0;

  constructor(maxSize: number = 5000) {
    this.chunks = [];
    this.maxSize = maxSize;
  }

  push(data: string): TerminalOutputChunk {
    const seqStart = this.seq;
    const seq = seqStart + Buffer.byteLength(data, 'utf8');
    const chunk = { data, seqStart, seq };

    if (this.chunks.length >= this.maxSize) {
      this.chunks.shift();
    }
    this.chunks.push(chunk);
    this.index++;
    this.seq = seq;

    return chunk;
  }

  getAll(): string[] {
    return this.chunks.map((chunk) => chunk.data);
  }

  getChunks(): TerminalOutputChunk[] {
    return this.chunks.map((chunk) => ({ ...chunk }));
  }

  getSince(index: number): string[] {
    const start = index - (this.index - this.chunks.length);
    if (start < 0) return this.getAll();
    return this.chunks.slice(start).map((chunk) => chunk.data);
  }

  replayFrom(lastSeq: number): RingBufferReplayResult {
    const oldestSeq = this.oldestSeq;
    if (this.chunks.length > 0 && lastSeq < oldestSeq) {
      return { status: 'too_old', oldestSeq, seq: this.seq };
    }

    return {
      status: 'ok',
      chunks: this.chunks.filter((chunk) => chunk.seq > lastSeq).map((chunk) => ({ ...chunk })),
      seq: this.seq,
    };
  }

  canReplayFrom(lastSeq: number): boolean {
    if (lastSeq >= this.seq) return true;
    return this.chunks.length === 0 || lastSeq >= this.oldestSeq;
  }

  get currentIndex(): number {
    return this.index;
  }

  get currentSeq(): number {
    return this.seq;
  }

  get oldestSeq(): number {
    return this.chunks[0]?.seqStart ?? this.seq;
  }
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
bun run test -- packages/server/src/terminal/ring-buffer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/terminal/ring-buffer.ts packages/server/src/terminal/ring-buffer.test.ts
git commit -m "feat(server): track terminal output sequences"
```

---

### Task 3: Persist Optional Output Sequences

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/schema.test.ts`
- Modify: `packages/server/src/db/index.ts`
- Modify: `packages/server/src/session/store.ts`
- Modify: `packages/server/src/session/store.test.ts`

- [ ] **Step 1: Add failing schema/store tests**

In `packages/server/src/db/schema.test.ts`, append:

```ts
  it('contains terminal output sequence columns', () => {
    expect(SCHEMA_SQL).toContain('seq_start INTEGER');
    expect(SCHEMA_SQL).toContain('seq_end INTEGER');
  });
```

In `packages/server/src/session/store.test.ts`, append this test inside the existing `describe('SessionStore', ...)` block:

```ts
  it('persists terminal output sequence metadata when provided', () => {
    const session = store.create({ workspaceId: '/tmp', provider: 'mock' });

    store.appendTerminalOutput(session.id, { data: 'abc', seqStart: 0, seq: 3 });

    const rows = db
      .prepare('SELECT data, seq_start, seq_end FROM terminal_outputs WHERE session_id = ?')
      .all(session.id) as Array<Record<string, unknown>>;

    expect(rows).toEqual([{ data: 'abc', seq_start: 0, seq_end: 3 }]);
    expect(store.getTerminalOutputHistory(session.id)).toEqual(['abc']);
  });
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run:

```bash
bun run test -- packages/server/src/db/schema.test.ts packages/server/src/session/store.test.ts
```

Expected: FAIL because schema SQL and `appendTerminalOutput` do not support sequence metadata.

- [ ] **Step 3: Update schema SQL**

In `packages/server/src/db/schema.ts`, change the `terminal_outputs` table to include:

```sql
  data TEXT NOT NULL,
  seq_start INTEGER,
  seq_end INTEGER,
  created_at TEXT NOT NULL,
```

- [ ] **Step 4: Add an idempotent migration for existing databases**

In `packages/server/src/db/index.ts`, add this helper above `export class Database`:

```ts
function ensureTerminalOutputSequenceColumns(db: SqliteDb): void {
  const columns = db.prepare('PRAGMA table_info(terminal_outputs)').all() as Array<{
    name?: unknown;
  }>;
  const names = new Set(columns.map((column) => String(column.name)));

  if (!names.has('seq_start')) {
    db.exec('ALTER TABLE terminal_outputs ADD COLUMN seq_start INTEGER');
  }
  if (!names.has('seq_end')) {
    db.exec('ALTER TABLE terminal_outputs ADD COLUMN seq_end INTEGER');
  }
}
```

Then call it in the constructor immediately after `this.db.exec(SCHEMA_SQL);`:

```ts
    ensureTerminalOutputSequenceColumns(this.db);
```

- [ ] **Step 5: Update `appendTerminalOutput`**

In `packages/server/src/session/store.ts`, import the chunk type:

```ts
import type { CreateSessionInput, Session, SessionStatus, TerminalOutputChunk } from '@cubby/core';
```

Change `appendTerminalOutput` to accept either old string data or a sequenced chunk:

```ts
  appendTerminalOutput(
    sessionId: string,
    output: string | TerminalOutputChunk,
    limit = TERMINAL_OUTPUT_HISTORY_LIMIT,
  ): void {
    const now = new Date().toISOString();
    const data = typeof output === 'string' ? output : output.data;
    const seqStart = typeof output === 'string' ? null : output.seqStart;
    const seqEnd = typeof output === 'string' ? null : output.seq;

    this.db
      .prepare(
        'INSERT INTO terminal_outputs (session_id, data, seq_start, seq_end, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(sessionId, data, seqStart, seqEnd, now);

    this.db
      .prepare(
        `DELETE FROM terminal_outputs
         WHERE session_id = ?
           AND id NOT IN (
             SELECT id
             FROM terminal_outputs
             WHERE session_id = ?
             ORDER BY id DESC
             LIMIT ?
           )`,
      )
      .run(sessionId, sessionId, limit);
  }
```

- [ ] **Step 6: Run focused tests to verify they pass**

Run:

```bash
bun run test -- packages/server/src/db/schema.test.ts packages/server/src/session/store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/db/schema.test.ts packages/server/src/db/index.ts packages/server/src/session/store.ts packages/server/src/session/store.test.ts
git commit -m "feat(server): persist terminal output sequence metadata"
```

---

### Task 4: SessionManager Replay and Reconcile

**Files:**
- Modify: `packages/server/src/session/manager.test.ts`
- Modify: `packages/server/src/session/manager.ts`

- [ ] **Step 1: Add failing SessionManager tests**

Append these tests inside `describe('SessionManager', ...)` in `packages/server/src/session/manager.test.ts`:

```ts
  it('returns sequenced live replay chunks after a rendered seq', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 20));

    const fullReplay = manager.getOutputReplay(session.id, 0);
    expect(fullReplay.status).toBe('ok');
    if (fullReplay.status !== 'ok') throw new Error('expected ok replay');

    const firstSeq = fullReplay.chunks[0]?.seq ?? 0;
    const partialReplay = manager.getOutputReplay(session.id, firstSeq);

    expect(partialReplay).toMatchObject({
      status: 'ok',
      sessionId: session.id,
      seq: fullReplay.seq,
    });
    if (partialReplay.status !== 'ok') throw new Error('expected ok partial replay');
    expect(partialReplay.chunks.every((chunk) => chunk.seq > firstSeq)).toBe(true);
  });

  it('reconciles a caught-up live session as noop', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 20));

    const replay = manager.getOutputReplay(session.id, 0);
    if (replay.status !== 'ok') throw new Error('expected ok replay');

    expect(manager.reconcileTerminalRecovery(session.id, replay.seq)).toEqual({
      action: 'noop',
      sessionId: session.id,
      headSeq: replay.seq,
    });
  });

  it('reconciles missing live output as replay', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 20));

    const replay = manager.getOutputReplay(session.id, 0);
    if (replay.status !== 'ok') throw new Error('expected ok replay');

    expect(manager.reconcileTerminalRecovery(session.id, 0)).toEqual({
      action: 'replay',
      sessionId: session.id,
      fromSeq: 0,
      headSeq: replay.seq,
    });
  });

  it('reconciles an ended caught-up session as closed', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 100));

    const replay = manager.getOutputReplay(session.id, 0);
    if (replay.status !== 'ok') throw new Error('expected ok replay');

    expect(manager.reconcileTerminalRecovery(session.id, replay.seq)).toEqual({
      action: 'closed',
      sessionId: session.id,
      headSeq: replay.seq,
      exitCode: 0,
    });
  });

  it('reconciles evicted live output as unrecoverable', async () => {
    const provider: AgentProvider = {
      name: 'evicting',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        for (const output of ['one', 'two', 'three']) onOutput(output);
        return {
          pid: 40_000,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    manager = new SessionManager(store, { outputHistoryLimit: 2 });
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'evicting' });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    expect(manager.reconcileTerminalRecovery(session.id, 0)).toEqual({
      action: 'unrecoverable',
      sessionId: session.id,
      reason: 'too_old_no_snapshot',
    });
  });
```

Also update the existing `"starts a session"` test callback from:

```ts
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }, (d) =>
      outputs.push(d),
    );
```

to:

```ts
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }, (chunk) =>
      outputs.push(chunk.data),
    );
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run:

```bash
bun run test -- packages/server/src/session/manager.test.ts
```

Expected: FAIL because `getOutputReplay`, `reconcileTerminalRecovery`, and the optional constructor config do not exist.

- [ ] **Step 3: Update SessionManager constructor and callback types**

In `packages/server/src/session/manager.ts`, update imports:

```ts
  TerminalOutputChunk,
  TerminalReplayResult,
  RecoveryReconcileResult,
```

Add an options interface near `OUTPUT_HISTORY_LIMIT`:

```ts
interface SessionManagerOptions {
  outputHistoryLimit?: number;
}
```

Change the constructor:

```ts
  private readonly outputHistoryLimit: number;

  constructor(
    private store: SessionStore,
    options: SessionManagerOptions = {},
  ) {
    this.outputHistoryLimit = options.outputHistoryLimit ?? OUTPUT_HISTORY_LIMIT;
  }
```

Change `startSession`, `resumeSession`, and `spawnSession` callback types from `(data: string) => void` to:

```ts
onOutput?: (chunk: TerminalOutputChunk) => void
```

- [ ] **Step 4: Sequence provider output in `spawnSession`**

In `spawnSession`, replace `new RingBuffer(OUTPUT_HISTORY_LIMIT)` with:

```ts
    const outputBuffer = new RingBuffer(this.outputHistoryLimit);
```

Inside the provider output callback, replace the existing `push` and persistence block with:

```ts
          const chunk = outputBuffer.push(data);
          this.store.appendTerminalOutput(sessionId, chunk, this.outputHistoryLimit);
          if (this.processes.has(sessionId)) {
            this.store.updateStatus(sessionId, 'running');
            this.notifyStatusChange(sessionId, 'running');
          }
          onOutput?.(chunk);
```

- [ ] **Step 5: Add replay and reconcile methods**

Add these methods above `recordTerminalInput`:

```ts
  getOutputReplay(sessionId: string, lastSeq = 0): TerminalReplayResult {
    const session = this.store.get(sessionId);
    if (!session) return { status: 'unknown', sessionId };

    const buffer = this.outputBuffers.get(sessionId);
    if (buffer) {
      const replay = buffer.replayFrom(lastSeq);
      if (replay.status === 'too_old') {
        return { status: 'too_old', sessionId, oldestSeq: replay.oldestSeq, seq: replay.seq };
      }
      return { status: 'ok', sessionId, chunks: replay.chunks, seq: replay.seq };
    }

    const history = this.getOutputHistory(sessionId);
    if (lastSeq > 0) {
      return {
        status: 'too_old',
        sessionId,
        oldestSeq: 0,
        seq: history.reduce((seq, data) => seq + Buffer.byteLength(data, 'utf8'), 0),
      };
    }

    let seq = 0;
    const chunks = history.map((data) => {
      const seqStart = seq;
      seq += Buffer.byteLength(data, 'utf8');
      return { data, seqStart, seq };
    });

    return { status: 'ok', sessionId, chunks, seq };
  }

  reconcileTerminalRecovery(sessionId: string, renderedSeq: number): RecoveryReconcileResult {
    const session = this.store.get(sessionId);
    if (!session) {
      return { action: 'unrecoverable', sessionId, reason: 'unknown_session' };
    }

    const buffer = this.outputBuffers.get(sessionId);
    const headSeq = buffer?.currentSeq ?? 0;
    const live = this.processes.has(sessionId);

    if (renderedSeq >= headSeq) {
      if (live) return { action: 'noop', sessionId, headSeq };
      return { action: 'closed', sessionId, headSeq, exitCode: session.exitCode };
    }

    if (buffer?.canReplayFrom(renderedSeq)) {
      return { action: 'replay', sessionId, fromSeq: renderedSeq, headSeq };
    }

    if (live) {
      return { action: 'unrecoverable', sessionId, reason: 'too_old_no_snapshot' };
    }

    return { action: 'closed', sessionId, headSeq, exitCode: session.exitCode };
  }
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
bun run test -- packages/server/src/session/manager.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/session/manager.ts packages/server/src/session/manager.test.ts
git commit -m "feat(server): reconcile live terminal recovery"
```

---

### Task 5: WebSocket Replay and Reconcile Commands

**Files:**
- Modify: `packages/server/src/ws/handler.test.ts`
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Update failing handler tests**

In `packages/server/src/ws/handler.test.ts`, update the existing `"replays buffered terminal output for a session"` expectation to:

```ts
    expect(response).toEqual({
      id: 'replay-1',
      ok: true,
      data: {
        status: 'ok',
        sessionId: session.id,
        chunks: [{ data: 'history chunk', seqStart: 0, seq: 13 }],
        seq: 13,
      },
    });
```

Update `"replays provider transcript history when terminal output history is empty"` to expect sequenced chunks:

```ts
    const first = `transcript for ${session.id} in /tmp/transcript`;
    expect(response).toEqual({
      id: 'replay-transcript',
      ok: true,
      data: {
        status: 'ok',
        sessionId: session.id,
        chunks: [
          { data: first, seqStart: 0, seq: Buffer.byteLength(first, 'utf8') },
          {
            data: '\r\n',
            seqStart: Buffer.byteLength(first, 'utf8'),
            seq: Buffer.byteLength(first, 'utf8') + 2,
          },
        ],
        seq: Buffer.byteLength(first, 'utf8') + 2,
      },
    });
```

In `"subscribes the starting websocket before the first terminal output"`, update the terminal output event expectation:

```ts
    const data = `first output for ${session.id}`;
    expect(sent).toContainEqual({
      evt: 'terminal.output',
      data: { sessionId: session.id, data, seqStart: 0, seq: Buffer.byteLength(data, 'utf8') },
    });
```

Append:

```ts
  it('reconciles live terminal recovery over websocket', async () => {
    const provider: AgentProvider = {
      name: 'reconcile',
      async spawn(
        _sessionId: string,
        _options: SpawnOptions,
        onOutput: (data: string) => void = () => {},
      ) {
        queueMicrotask(() => onOutput('abc'));
        return {
          pid: 991,
          onData: (_callback) => {},
          onExit: (_callback) => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    };
    manager.registerProvider(provider);
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'reconcile' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = await handler.handle({} as WebSocket, {
      id: 'recover-1',
      cmd: 'recovery.reconcile',
      args: { sessionId: session.id, renderedSeq: 0 },
    });

    expect(response).toEqual({
      id: 'recover-1',
      ok: true,
      data: { action: 'replay', sessionId: session.id, fromSeq: 0, headSeq: 3 },
    });
  });
```

- [ ] **Step 2: Run focused handler tests to verify they fail**

Run:

```bash
bun run test -- packages/server/src/ws/handler.test.ts
```

Expected: FAIL because handler still returns old replay shape and does not support `recovery.reconcile`.

- [ ] **Step 3: Update handler implementation**

In `packages/server/src/ws/handler.ts`, ensure `WS_COMMANDS.RECOVERY_RECONCILE` is handled:

```ts
        case WS_COMMANDS.RECOVERY_RECONCILE:
          return this.recoveryReconcile(request);
```

Update `sessionStart` and `sessionResume` callbacks:

```ts
    await this.sessionManager.startSession(sessionId, { cwd, ...size }, (chunk) => {
      this.hub.broadcast(topic, { evt: 'terminal.output', data: { sessionId, ...chunk } });
    });
```

```ts
    await this.sessionManager.resumeSession(sessionId, { cwd, ...size }, (chunk) => {
      this.hub.broadcast(topic, { evt: 'terminal.output', data: { sessionId, ...chunk } });
    });
```

Replace `terminalReplay` data construction with:

```ts
    const { lastSeq } = req.args as { sessionId: string; lastSeq?: number };
    return {
      id: req.id,
      ok: true,
      data: this.sessionManager.getOutputReplay(sessionId, lastSeq ?? 0),
    };
```

Add:

```ts
  private recoveryReconcile(req: WSRequest): WSResponse {
    const { sessionId, renderedSeq } = req.args as { sessionId: string; renderedSeq?: number };
    return {
      id: req.id,
      ok: true,
      data: this.sessionManager.reconcileTerminalRecovery(sessionId, renderedSeq ?? 0),
    };
  }
```

- [ ] **Step 4: Run focused handler tests**

Run:

```bash
bun run test -- packages/server/src/ws/handler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/handler.ts packages/server/src/ws/handler.test.ts
git commit -m "feat(server): expose terminal recovery commands"
```

---

### Task 6: Frontend Recovery Helpers

**Files:**
- Create: `packages/web/src/components/session/terminal-recovery.ts`
- Create: `packages/web/src/components/session/terminal-recovery.test.ts`

- [ ] **Step 1: Create helper tests**

Create `packages/web/src/components/session/terminal-recovery.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  filterRenderableLiveChunks,
  isRecoveryReconcileData,
  isTerminalOutputData,
  isTerminalReplayData,
} from './terminal-recovery.js';

describe('terminal recovery helpers', () => {
  it('validates sequenced terminal output payloads', () => {
    expect(
      isTerminalOutputData(
        { sessionId: 's1', data: 'abc', seqStart: 0, seq: 3 },
        's1',
      ),
    ).toBe(true);
    expect(isTerminalOutputData({ sessionId: 's1', data: 'abc' }, 's1')).toBe(false);
    expect(
      isTerminalOutputData(
        { sessionId: 'other', data: 'abc', seqStart: 0, seq: 3 },
        's1',
      ),
    ).toBe(false);
  });

  it('validates replay responses', () => {
    expect(
      isTerminalReplayData(
        {
          status: 'ok',
          sessionId: 's1',
          chunks: [{ data: 'abc', seqStart: 0, seq: 3 }],
          seq: 3,
        },
        's1',
      ),
    ).toBe(true);
    expect(
      isTerminalReplayData({ status: 'too_old', sessionId: 's1', oldestSeq: 4, seq: 8 }, 's1'),
    ).toBe(true);
    expect(isTerminalReplayData({ sessionId: 's1', chunks: ['abc'] }, 's1')).toBe(false);
  });

  it('validates reconcile responses', () => {
    expect(isRecoveryReconcileData({ action: 'noop', sessionId: 's1', headSeq: 3 }, 's1')).toBe(
      true,
    );
    expect(
      isRecoveryReconcileData(
        { action: 'unrecoverable', sessionId: 's1', reason: 'too_old_no_snapshot' },
        's1',
      ),
    ).toBe(true);
    expect(isRecoveryReconcileData({ action: 'noop', sessionId: 'other', headSeq: 3 }, 's1')).toBe(
      false,
    );
  });

  it('filters live chunks that have already been rendered', () => {
    const chunks = [
      { data: 'old', seqStart: 0, seq: 3 },
      { data: 'next', seqStart: 3, seq: 7 },
      { data: 'future', seqStart: 7, seq: 13 },
    ];

    expect(filterRenderableLiveChunks(chunks, 7)).toEqual([chunks[2]]);
  });
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
bun run test -- packages/web/src/components/session/terminal-recovery.test.ts
```

Expected: FAIL because the helper file does not exist.

- [ ] **Step 3: Implement helper file**

Create `packages/web/src/components/session/terminal-recovery.ts`:

```ts
import type { RecoveryReconcileResult, TerminalOutputChunk, TerminalReplayResult } from '@cubby/core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isChunk(value: unknown): value is TerminalOutputChunk {
  return (
    isRecord(value) &&
    typeof value.data === 'string' &&
    typeof value.seqStart === 'number' &&
    Number.isFinite(value.seqStart) &&
    typeof value.seq === 'number' &&
    Number.isFinite(value.seq) &&
    value.seq >= value.seqStart
  );
}

export function isTerminalOutputData(
  value: unknown,
  sessionId: string,
): value is TerminalOutputChunk & { sessionId: string } {
  return isRecord(value) && value.sessionId === sessionId && isChunk(value);
}

export function isTerminalReplayData(
  value: unknown,
  sessionId: string,
): value is TerminalReplayResult {
  if (!isRecord(value) || value.sessionId !== sessionId || typeof value.status !== 'string') {
    return false;
  }
  if (value.status === 'unknown') return true;
  if (value.status === 'too_old') {
    return typeof value.oldestSeq === 'number' && typeof value.seq === 'number';
  }
  return (
    value.status === 'ok' &&
    typeof value.seq === 'number' &&
    Array.isArray(value.chunks) &&
    value.chunks.every(isChunk)
  );
}

export function isRecoveryReconcileData(
  value: unknown,
  sessionId: string,
): value is RecoveryReconcileResult {
  if (!isRecord(value) || value.sessionId !== sessionId || typeof value.action !== 'string') {
    return false;
  }
  if (value.action === 'noop') return typeof value.headSeq === 'number';
  if (value.action === 'replay') {
    return typeof value.fromSeq === 'number' && typeof value.headSeq === 'number';
  }
  if (value.action === 'closed') return typeof value.headSeq === 'number';
  if (value.action === 'unrecoverable') {
    return value.reason === 'too_old_no_snapshot' || value.reason === 'unknown_session';
  }
  return false;
}

export function filterRenderableLiveChunks(
  chunks: TerminalOutputChunk[],
  renderedSeq: number,
): TerminalOutputChunk[] {
  return chunks.filter((chunk) => chunk.seq > renderedSeq);
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
bun run test -- packages/web/src/components/session/terminal-recovery.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/session/terminal-recovery.ts packages/web/src/components/session/terminal-recovery.test.ts
git commit -m "feat(web): add terminal recovery helpers"
```

---

### Task 7: SessionView Live Recovery

**Files:**
- Modify: `packages/web/src/components/session/session-view.tsx`

- [ ] **Step 1: Update imports and remove local replay validators**

In `packages/web/src/components/session/session-view.tsx`, import the chunk type and helpers:

```ts
import type { Session, TerminalOutputChunk, WSEvent, WSResponse } from '@cubby/core';
import {
  filterRenderableLiveChunks,
  isRecoveryReconcileData,
  isTerminalOutputData,
  isTerminalReplayData,
} from './terminal-recovery.js';
```

Delete the local `isTerminalOutputData` and `isTerminalReplayData` functions from this file.

- [ ] **Step 2: Add recovery refs and state**

Near existing refs, add:

```ts
  const renderedSeqRef = useRef(0);
  const pendingLiveChunksRef = useRef<TerminalOutputChunk[]>([]);
  const recoveringRef = useRef(false);
  const initialRecoveryDoneRef = useRef(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryRequest, setRecoveryRequest] = useState(0);
```

- [ ] **Step 3: Add chunk writing helpers inside the component**

Add these callbacks before the live output `useEffect`:

```ts
  const writeChunk = useCallback(async (chunk: TerminalOutputChunk) => {
    await termRef.current?.writeAsync(chunk.data);
    renderedSeqRef.current = Math.max(renderedSeqRef.current, chunk.seq);
  }, []);

  const flushPendingLiveChunks = useCallback(async () => {
    const chunks = filterRenderableLiveChunks(
      pendingLiveChunksRef.current,
      renderedSeqRef.current,
    ).sort((left, right) => left.seqStart - right.seqStart);
    pendingLiveChunksRef.current = [];

    for (const chunk of chunks) {
      if (chunk.seqStart > renderedSeqRef.current) {
        pendingLiveChunksRef.current.push(chunk);
        return false;
      }
      await writeChunk(chunk);
    }

    return true;
  }, [writeChunk]);
```

- [ ] **Step 4: Replace the live output message handler**

Replace the current `// Subscribe to terminal output events` effect with:

```ts
  useEffect(() => {
    const unsub = onMessage((msg) => {
      if (!live) return;
      if (
        'evt' in msg &&
        msg.evt === 'terminal.output' &&
        isTerminalOutputData(msg.data, session.id)
      ) {
        const chunk = msg.data;
        setReplayState((prev) => (prev.hasHistory ? prev : { loaded: true, hasHistory: true }));

        if (!initialRecoveryDoneRef.current || recoveringRef.current) {
          pendingLiveChunksRef.current.push(chunk);
          return;
        }

        if (chunk.seqStart > renderedSeqRef.current) {
          pendingLiveChunksRef.current.push(chunk);
          setRecoveryRequest((request) => request + 1);
          return;
        }

        if (chunk.seq > renderedSeqRef.current) {
          void writeChunk(chunk);
        }
      }
    });
    return unsub;
  }, [session.id, live, onMessage, writeChunk]);
```

- [ ] **Step 5: Replace live replay effect with reconcile-aware recovery**

In the replay `useEffect`, split live and ended behavior. Include `recoveryRequest` in the effect dependency list so live seq gaps trigger another recovery pass. For the live path, use:

```ts
    if (live) {
      let cancelled = false;
      replayGenerationRef.current += 1;
      const generation = replayGenerationRef.current;
      recoveringRef.current = true;
      initialRecoveryDoneRef.current = false;
      setRecoveryError(null);

      request({
        id: `recover-${session.id}-${Date.now()}`,
        cmd: 'recovery.reconcile',
        args: { sessionId: session.id, renderedSeq: renderedSeqRef.current },
      })
        .then(async (res) => {
          if (cancelled || replayGenerationRef.current !== generation) return;
          if (!res.ok || !isRecoveryReconcileData(res.data, session.id)) {
            setRecoveryError('Terminal recovery check failed');
            return;
          }

          if (res.data.action === 'noop') {
            await flushPendingLiveChunks();
            setReplayState((prev) => ({ loaded: true, hasHistory: prev.hasHistory }));
            return;
          }

          if (res.data.action === 'unrecoverable') {
            termRef.current?.reset();
            pendingLiveChunksRef.current = [];
            setRecoveryError('Terminal history is no longer available');
            setReplayState({ loaded: true, hasHistory: false });
            return;
          }

          if (res.data.action === 'closed') {
            await flushPendingLiveChunks();
            setReplayState((prev) => ({ loaded: true, hasHistory: prev.hasHistory }));
            return;
          }

          const replayRes = await request({
            id: `replay-${session.id}-${session.status}-${Date.now()}`,
            cmd: 'terminal.replay',
            args: { sessionId: session.id, lastSeq: res.data.fromSeq },
          });
          if (cancelled || replayGenerationRef.current !== generation) return;
          if (!replayRes.ok || !isTerminalReplayData(replayRes.data, session.id)) {
            setRecoveryError('Terminal replay failed');
            return;
          }
          if (replayRes.data.status === 'too_old' || replayRes.data.status === 'unknown') {
            termRef.current?.reset();
            pendingLiveChunksRef.current = [];
            setRecoveryError('Terminal history is no longer available');
            setReplayState({ loaded: true, hasHistory: false });
            return;
          }

          for (const chunk of replayRes.data.chunks) {
            if (cancelled || replayGenerationRef.current !== generation) return;
            if (chunk.seq > renderedSeqRef.current) await writeChunk(chunk);
          }
          const flushed = await flushPendingLiveChunks();
          if (!flushed) {
            setRecoveryError('Terminal replay is incomplete');
            return;
          }
          setReplayState({
            loaded: true,
            hasHistory:
              replayRes.data.chunks.some((chunk) => chunk.data.length > 0) ||
              renderedSeqRef.current > 0,
          });
        })
        .catch(() => {
          if (!cancelled) setRecoveryError('Terminal recovery failed');
        })
        .finally(() => {
          if (!cancelled && replayGenerationRef.current === generation) {
            recoveringRef.current = false;
            initialRecoveryDoneRef.current = true;
          }
        });

      return () => {
        cancelled = true;
      };
    }
```

Keep the ended path, but update it to expect sequenced `ok` replay data:

```ts
        if (!res.ok || !isTerminalReplayData(res.data, session.id) || res.data.status !== 'ok') {
          setReplayState({ loaded: true, hasHistory: false });
          return;
        }
        const replayChunks = sanitizeEndedReplayChunks(res.data.chunks.map((chunk) => chunk.data));
```

- [ ] **Step 6: Reset recovery refs on fresh start/resume**

At the beginning of `startSession` and `handleResume`, before sending the command, add:

```ts
    renderedSeqRef.current = 0;
    pendingLiveChunksRef.current = [];
    recoveringRef.current = false;
    initialRecoveryDoneRef.current = false;
    setRecoveryError(null);
```

- [ ] **Step 7: Render recovery error overlay**

Near `showEmptyEndedHistory`, add:

```ts
  const showRecoveryError = live && recoveryError !== null;
```

Inside the terminal container, after the empty ended history overlay, render:

```tsx
        {showRecoveryError && (
          <div
            data-testid="terminal-recovery-error"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              background: 'rgba(5, 6, 6, 0.92)',
              color: '#dedbd2',
              textAlign: 'center',
              fontSize: '13px',
              fontWeight: 650,
            }}
          >
            {recoveryError}
          </div>
        )}
```

- [ ] **Step 8: Run frontend and related server tests**

Run:

```bash
bun run test -- packages/web/src/components/session/terminal-recovery.test.ts packages/web/src/components/session/terminal-replay.test.ts packages/server/src/ws/handler.test.ts packages/server/src/session/manager.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/components/session/session-view.tsx
git commit -m "feat(web): recover live terminal sessions by sequence"
```

---

### Task 8: E2E and Final Verification

**Files:**
- Modify: `e2e/app.spec.ts`

- [ ] **Step 1: Add live refresh recovery E2E test**

Append this test in `test.describe('Cubby MVP', ...)` near existing terminal replay tests:

```ts
  test('refreshing a running session replays live output once', async ({ page }) => {
    test.skip(
      !MOCK_CLAUDE_PROVIDER_ENABLED,
      'Requires CUBBY_MOCK_CLAUDE_PROVIDER=1 for deterministic terminal output',
    );

    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-live-refresh-${stamp}`;
    const session = await createSession(page, { workspaceId, title: `Live Refresh ${stamp}` });
    const marker = `Mock Claude Code ready for ${session.id.slice(0, 8)}`;

    await page.goto('/');
    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, session.title);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await assertActiveDetail(page, { title: session.title, status: 'running', action: 'Stop' });
    await expect
      .poll(async () => countOccurrences(await terminalText(page), marker), { timeout: 10000 })
      .toBe(3);

    await page.reload();
    await assertActiveDetail(page, { title: session.title, status: 'running', action: 'Stop' });
    await expect
      .poll(async () => countOccurrences(await terminalText(page), marker), { timeout: 10000 })
      .toBe(3);
    await expect(page.getByTestId('terminal-recovery-error')).toHaveCount(0);
  });
```

- [ ] **Step 2: Add live switch recovery E2E test**

Append:

```ts
  test('switching back to a running session replays missed live output without duplication', async ({
    page,
  }) => {
    test.skip(
      !MOCK_CLAUDE_PROVIDER_ENABLED,
      'Requires CUBBY_MOCK_CLAUDE_PROVIDER=1 for deterministic terminal output',
    );

    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-live-switch-${stamp}`;
    const first = await createSession(page, { workspaceId, title: `Live Switch A ${stamp}` });
    const second = await createSession(page, { workspaceId, title: `Live Switch B ${stamp}` });
    const marker = `Mock Claude Code ready for ${first.id.slice(0, 8)}`;

    await page.goto('/');
    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, first.title);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await assertActiveDetail(page, { title: first.title, status: 'running', action: 'Stop' });
    await expect
      .poll(async () => countOccurrences(await terminalText(page), marker), { timeout: 10000 })
      .toBeGreaterThanOrEqual(1);

    await selectSessionTab(group, second.title);
    await assertActiveDetail(page, { title: second.title, status: 'draft', action: 'Start' });
    await page.waitForTimeout(1200);

    await selectSessionTab(group, first.title);
    await assertActiveDetail(page, { title: first.title, status: 'running', action: 'Stop' });
    await expect
      .poll(async () => countOccurrences(await terminalText(page), marker), { timeout: 10000 })
      .toBe(3);
    await expect(page.getByTestId('terminal-recovery-error')).toHaveCount(0);
  });
```

- [ ] **Step 3: Run focused E2E tests**

Run:

```bash
CUBBY_MOCK_CLAUDE_PROVIDER=1 bun run test:e2e -- --grep "refreshing a running session|switching back to a running session"
```

Expected: PASS.

- [ ] **Step 4: Run unit/integration verification**

Run:

```bash
bun run test -- packages/server/src/terminal/ring-buffer.test.ts packages/server/src/session/store.test.ts packages/server/src/session/manager.test.ts packages/server/src/ws/handler.test.ts packages/web/src/components/session/terminal-recovery.test.ts packages/web/src/components/session/terminal-replay.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full build and lint**

Run:

```bash
bun run build
bun run lint
```

Expected: both commands exit with status 0.

- [ ] **Step 6: Commit**

```bash
git add e2e/app.spec.ts
git commit -m "test(e2e): cover live terminal recovery"
```

---

## Self-Review Notes

- Spec coverage: sequence metadata, `terminal.replay(lastSeq)`, `recovery.reconcile`, live gap detection, initial live buffering, compatibility for ended replay, and tests are covered.
- Scope control: snapshot, binary transport, TerminalManager extraction, multi-terminal support, and server-restart recovery are excluded.
- Type consistency: the plan uses `TerminalOutputChunk.seqStart` and `TerminalOutputChunk.seq`, `TerminalReplayResult.status`, and `RecoveryReconcileResult.action` consistently across core, server, and web.
