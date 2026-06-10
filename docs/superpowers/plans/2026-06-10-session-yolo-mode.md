# Session Yolo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New sessions can choose yolo mode, default to yolo enabled, persist that choice, and launch Claude Code, Codex, and OpenCode with matching permission-bypass arguments.

**Architecture:** Store `yolo` as a persisted `Session` boolean so create, auto-start, manual start, resume, refresh, and service restart use one source of truth. `SessionManager` injects the persisted value into provider `SpawnOptions`, and provider classes translate it into CLI-specific arguments. The workspace picker owns the user-facing default-on checkbox and sends the selection through the existing `session.create` command.

**Tech Stack:** TypeScript strict mode, Bun workspaces, Fastify, SQLite via `Database`, Vitest, Playwright, React.

---

## File Structure

- Modify: `packages/core/src/types/session.ts`
  - Add `Session.yolo` and `CreateSessionInput.yolo`.
- Modify: `packages/core/src/types/provider.ts`
  - Add `SpawnOptions.yolo`.
- Modify: `packages/server/src/db/schema.ts`
  - Add `sessions.yolo` to the base schema.
- Modify: `packages/server/src/db/index.ts`
  - Add runtime migration for existing SQLite databases missing `sessions.yolo`.
- Modify: `packages/server/src/session/store.ts`
  - Persist and hydrate yolo.
- Modify: `packages/server/src/session/store.test.ts`
  - Cover yolo defaults, explicit false, and migration.
- Modify: `packages/server/src/session/manager.ts`
  - Pass persisted yolo into provider spawn options on start and resume.
- Modify: `packages/server/src/session/manager.test.ts`
  - Cover start and resume spawn options.
- Modify: `packages/server/src/http/routes.ts`
  - Accept `yolo` on `POST /api/sessions`.
- Modify: `packages/server/src/ws/handler.ts`
  - Accept `yolo` on `session.create`.
- Modify: `packages/server/src/server.test.ts`
  - Cover HTTP create with explicit and default yolo.
- Modify: `packages/server/src/ws/handler.test.ts`
  - Cover WebSocket create with explicit yolo.
- Modify: `packages/server/src/provider/claude-code.ts`
  - Translate yolo to `--dangerously-skip-permissions`.
- Modify: `packages/server/src/provider/codex.ts`
  - Translate yolo to `--dangerously-bypass-approvals-and-sandbox`.
- Modify: `packages/server/src/provider/opencode.ts`
  - Use the `run --interactive --dangerously-skip-permissions --dir <cwd>` path for yolo sessions.
- Modify: `packages/server/src/provider/claude-code.test.ts`
  - Cover yolo and non-yolo args.
- Modify: `packages/server/src/provider/codex.test.ts`
  - Cover yolo and non-yolo args.
- Modify: `packages/server/src/provider/opencode.test.ts`
  - Cover yolo and non-yolo args.
- Modify: `packages/web/src/components/workspace/dir-picker.tsx`
  - Add default-on yolo checkbox and include it in `WorkspaceOpenSelection`.
- Modify: `packages/web/src/app.tsx`
  - Send `yolo` in `session.create`.
- Modify: `e2e/app.spec.ts`
  - Cover picker default, yolo off, and provider selection preservation.

---

### Task 1: Persist Yolo On Sessions

**Files:**
- Modify: `packages/core/src/types/session.ts`
- Modify: `packages/core/src/types/provider.ts`
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/index.ts`
- Modify: `packages/server/src/session/store.ts`
- Test: `packages/server/src/session/store.test.ts`

- [ ] **Step 1: Write the failing store tests**

In `packages/server/src/session/store.test.ts`, add these tests inside `describe('SessionStore', () => { ... })` after `it('creates a session', ...)`:

```ts
  it('defaults new sessions to yolo mode', () => {
    const session = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });

    expect(session.yolo).toBe(true);
    expect(store.get(session.id)?.yolo).toBe(true);
  });

  it('persists explicit non-yolo sessions', () => {
    const session = store.create({
      workspaceId: '/tmp/test',
      provider: 'claude-code',
      yolo: false,
    });

    expect(session.yolo).toBe(false);
    expect(store.get(session.id)?.yolo).toBe(false);
  });

  it('migrates existing session rows to yolo mode by default', async () => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {}

    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const legacyDb = new BetterSqlite3(dbPath);
    legacyDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        model TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        pid INTEGER,
        exit_code INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT
      );
      INSERT INTO sessions (
        id,
        workspace_id,
        title,
        provider,
        model,
        status,
        created_at,
        updated_at
      ) VALUES (
        'legacy-session',
        '/tmp/legacy',
        'Legacy session',
        'claude-code',
        NULL,
        'draft',
        '2026-06-10T00:00:00.000Z',
        '2026-06-10T00:00:00.000Z'
      );
    `);
    legacyDb.close();

    db = new Database(dbPath);
    store = new SessionStore(db);

    expect(store.get('legacy-session')).toMatchObject({
      id: 'legacy-session',
      yolo: true,
    });
  });
```

- [ ] **Step 2: Run store tests to verify they fail**

Run:

```bash
bunx vitest run packages/server/src/session/store.test.ts
```

Expected: FAIL because `Session` objects do not expose `yolo`, `CreateSessionInput` rejects `yolo`, and the schema has no yolo column.

- [ ] **Step 3: Add yolo to shared types**

In `packages/core/src/types/session.ts`, change the interfaces to:

```ts
export interface Session {
  id: string;
  workspaceId: string;
  title: string | null;
  provider: string;
  providerSessionId: string | null;
  model: string | null;
  yolo: boolean;
  status: SessionStatus;
  pid: number | null;
  exitCode: number | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface CreateSessionInput {
  workspaceId: string;
  provider: string;
  model?: string;
  title?: string;
  yolo?: boolean;
}
```

In `packages/core/src/types/provider.ts`, change `SpawnOptions` to:

```ts
export interface SpawnOptions {
  cwd: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
  model?: string;
  resume?: boolean;
  providerSessionId?: string;
  yolo?: boolean;
}
```

- [ ] **Step 4: Add the database column to the base schema**

In `packages/server/src/db/schema.ts`, add `yolo INTEGER NOT NULL DEFAULT 1,` between `model TEXT,` and `status TEXT NOT NULL DEFAULT 'draft',`:

```sql
  provider_session_id TEXT,
  model TEXT,
  yolo INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
```

- [ ] **Step 5: Add the runtime migration**

In `packages/server/src/db/index.ts`, add this helper after `ensureSessionProviderSessionIdColumn`:

```ts
function ensureSessionYoloColumn(db: SqliteDb): void {
  const columns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{
    name?: unknown;
  }>;
  const names = new Set(columns.map((column) => String(column.name)));

  if (!names.has('yolo')) {
    db.exec('ALTER TABLE sessions ADD COLUMN yolo INTEGER NOT NULL DEFAULT 1');
  }
}
```

Then call it in the `Database` constructor after `ensureSessionProviderSessionIdColumn(this.db);`:

```ts
    ensureSessionProviderSessionIdColumn(this.db);
    ensureSessionYoloColumn(this.db);
    ensureTerminalOutputSequenceColumns(this.db);
```

- [ ] **Step 6: Persist and hydrate yolo in SessionStore**

In `packages/server/src/session/store.ts`, add `yolo` to the session object:

```ts
      providerSessionId: null,
      model: input.model ?? null,
      yolo: input.yolo ?? true,
      status: 'draft',
```

Change the insert statement to include the column:

```ts
        'INSERT INTO sessions (id, workspace_id, title, provider, model, yolo, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
```

Add `session.yolo ? 1 : 0` to the `.run(...)` values between `session.model` and `session.status`:

```ts
        session.provider,
        session.model,
        session.yolo ? 1 : 0,
        session.status,
```

In `rowToSession`, add:

```ts
      yolo: row.yolo === 0 ? false : true,
```

between `model` and `status`.

- [ ] **Step 7: Run store tests to verify they pass**

Run:

```bash
bunx vitest run packages/server/src/session/store.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add packages/core/src/types/session.ts packages/core/src/types/provider.ts packages/server/src/db/schema.ts packages/server/src/db/index.ts packages/server/src/session/store.ts packages/server/src/session/store.test.ts
git commit -m "feat(core): persist session yolo mode"
```

---

### Task 2: Thread Yolo Through Server Create And Spawn

**Files:**
- Modify: `packages/server/src/session/manager.ts`
- Modify: `packages/server/src/http/routes.ts`
- Modify: `packages/server/src/ws/handler.ts`
- Test: `packages/server/src/session/manager.test.ts`
- Test: `packages/server/src/server.test.ts`
- Test: `packages/server/src/ws/handler.test.ts`

- [ ] **Step 1: Write failing SessionManager tests**

In `packages/server/src/session/manager.test.ts`, add these tests after `it('starts a session', ...)`:

```ts
  it('passes persisted yolo mode into provider spawn options when starting', async () => {
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'mock',
      yolo: false,
    });

    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    expect(mockProvider.spawnOptions[0]).toMatchObject({ yolo: false });
  });

  it('passes persisted yolo mode into provider spawn options when resuming', async () => {
    const session = manager.createSession({
      workspaceId: '/tmp',
      provider: 'mock',
      yolo: false,
    });
    store.updateStatus(session.id, 'ended', { exitCode: 0 });

    await manager.resumeSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });

    expect(mockProvider.spawnOptions[0]).toMatchObject({
      resume: true,
      yolo: false,
    });
  });
```

- [ ] **Step 2: Write failing HTTP create tests**

In `packages/server/src/server.test.ts`, add this test after `it('can start sessions with the mock OpenCode provider for CI E2E', ...)`:

```ts
  it('creates HTTP sessions with default and explicit yolo modes', async () => {
    const { app } = await createServer(0);

    const defaultResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { workspaceId: '/tmp', provider: 'claude-code', title: 'Default yolo' },
    });
    const explicitResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        workspaceId: '/tmp',
        provider: 'claude-code',
        title: 'No yolo',
        yolo: false,
      },
    });
    await app.close();

    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.json()).toMatchObject({ title: 'Default yolo', yolo: true });
    expect(explicitResponse.statusCode).toBe(200);
    expect(explicitResponse.json()).toMatchObject({ title: 'No yolo', yolo: false });
  });
```

- [ ] **Step 3: Write failing WebSocket create test**

In `packages/server/src/ws/handler.test.ts`, add this test before the rename tests:

```ts
  it('creates a session through websocket command with explicit yolo mode', async () => {
    const response = await handler.handle({} as WebSocket, {
      id: 'create-1',
      cmd: WS_COMMANDS.SESSION_CREATE,
      args: {
        workspaceId: '/tmp',
        provider: 'mock',
        title: 'No yolo',
        yolo: false,
      },
    });

    expect(response).toMatchObject({
      id: 'create-1',
      ok: true,
      data: {
        workspaceId: '/tmp',
        provider: 'mock',
        title: 'No yolo',
        yolo: false,
      },
    });
  });
```

- [ ] **Step 4: Run targeted tests to verify they fail**

Run:

```bash
bunx vitest run packages/server/src/session/manager.test.ts packages/server/src/server.test.ts packages/server/src/ws/handler.test.ts
```

Expected: FAIL because HTTP and WebSocket create ignore `yolo`, and `SessionManager` does not pass persisted yolo into spawn options.

- [ ] **Step 5: Pass persisted yolo to providers**

In `packages/server/src/session/manager.ts`, inside `spawnSession`, add `yolo: session.yolo,` to the provider options object:

```ts
        {
          ...options,
          model: session.model ?? undefined,
          resume,
          providerSessionId: session.providerSessionId ?? undefined,
          yolo: session.yolo,
        },
```

- [ ] **Step 6: Accept yolo in HTTP create**

In `packages/server/src/http/routes.ts`, extend the request body type for `POST /api/sessions`:

```ts
    const body = request.body as {
      workspaceId?: string;
      provider?: string;
      model?: string;
      title?: string;
      yolo?: unknown;
    };
```

Then pass yolo into `createSession`:

```ts
      yolo: typeof body.yolo === 'boolean' ? body.yolo : undefined,
```

The full create call becomes:

```ts
    const session = sessionManager.createSession({
      workspaceId: body.workspaceId ?? process.cwd(),
      provider: body.provider ?? 'claude-code',
      model: body.model,
      title: body.title,
      yolo: typeof body.yolo === 'boolean' ? body.yolo : undefined,
    });
```

- [ ] **Step 7: Accept yolo in WebSocket create**

In `packages/server/src/ws/handler.ts`, extend the `sessionCreate` args type:

```ts
    const { workspaceId, provider, model, title, yolo } = req.args as {
      workspaceId: string;
      provider: string;
      model?: string;
      title?: string;
      yolo?: unknown;
    };
```

Then pass yolo into `createSession`:

```ts
    const session = this.sessionManager.createSession({
      workspaceId,
      provider,
      model,
      title,
      yolo: typeof yolo === 'boolean' ? yolo : undefined,
    });
```

- [ ] **Step 8: Run targeted tests to verify they pass**

Run:

```bash
bunx vitest run packages/server/src/session/manager.test.ts packages/server/src/server.test.ts packages/server/src/ws/handler.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add packages/server/src/session/manager.ts packages/server/src/http/routes.ts packages/server/src/ws/handler.ts packages/server/src/session/manager.test.ts packages/server/src/server.test.ts packages/server/src/ws/handler.test.ts
git commit -m "feat(server): thread session yolo mode"
```

---

### Task 3: Add Provider Yolo Arguments

**Files:**
- Modify: `packages/server/src/provider/claude-code.ts`
- Modify: `packages/server/src/provider/codex.ts`
- Modify: `packages/server/src/provider/opencode.ts`
- Test: `packages/server/src/provider/claude-code.test.ts`
- Test: `packages/server/src/provider/codex.test.ts`
- Test: `packages/server/src/provider/opencode.test.ts`

- [ ] **Step 1: Write failing Claude provider tests**

In `packages/server/src/provider/claude-code.test.ts`, add these tests after `it('builds interactive args without print mode', ...)`:

```ts
  it('builds yolo args for a new Claude Code session', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({
      sessionId: '00000000-0000-4000-8000-000000000001',
      yolo: true,
    });

    expect(args).toEqual([
      '--session-id',
      '00000000-0000-4000-8000-000000000001',
      '--dangerously-skip-permissions',
    ]);
  });

  it('does not add Claude Code permission bypass args when yolo is false', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({
      sessionId: '00000000-0000-4000-8000-000000000001',
      yolo: false,
    });

    expect(args).toEqual(['--session-id', '00000000-0000-4000-8000-000000000001']);
  });
```

- [ ] **Step 2: Write failing Codex provider tests**

In `packages/server/src/provider/codex.test.ts`, add this test after `it('builds interactive args with cwd and model', ...)`:

```ts
  it('builds yolo args with cwd and model', () => {
    const provider = new CodexProvider();

    const args = provider.buildArgs({ cwd: '/tmp/project', model: 'gpt-5', yolo: true });

    expect(args).toEqual([
      '--cd',
      '/tmp/project',
      '--model',
      'gpt-5',
      '--dangerously-bypass-approvals-and-sandbox',
    ]);
  });
```

Add this test after `it('builds resume args with a mapped provider session id', ...)`:

```ts
  it('builds yolo resume args with a mapped provider session id', () => {
    const provider = new CodexProvider();

    const args = provider.buildArgs({
      cwd: '/tmp/project',
      resume: true,
      providerSessionId: 'codex-session-1',
      yolo: true,
    });

    expect(args).toEqual([
      'resume',
      '--cd',
      '/tmp/project',
      '--dangerously-bypass-approvals-and-sandbox',
      'codex-session-1',
    ]);
  });
```

- [ ] **Step 3: Write failing OpenCode provider tests**

In `packages/server/src/provider/opencode.test.ts`, add this test after `it('builds interactive args with cwd and model', ...)`:

```ts
  it('builds yolo direct interactive args with cwd and model', () => {
    const provider = new OpenCodeProvider();

    const args = provider.buildArgs({
      cwd: '/tmp/project',
      model: 'anthropic/claude-sonnet-4',
      yolo: true,
    });

    expect(args).toEqual([
      'run',
      '--interactive',
      '--dangerously-skip-permissions',
      '--dir',
      '/tmp/project',
      '--model',
      'anthropic/claude-sonnet-4',
    ]);
  });
```

Add this test after `it('builds resume args with a mapped provider session id', ...)`:

```ts
  it('builds yolo direct interactive resume args with a mapped provider session id', () => {
    const provider = new OpenCodeProvider();

    const args = provider.buildArgs({
      cwd: '/tmp/project',
      resume: true,
      providerSessionId: 'opencode-session-1',
      yolo: true,
    });

    expect(args).toEqual([
      'run',
      '--interactive',
      '--dangerously-skip-permissions',
      '--dir',
      '/tmp/project',
      '--session',
      'opencode-session-1',
    ]);
  });
```

- [ ] **Step 4: Run provider tests to verify they fail**

Run:

```bash
bunx vitest run packages/server/src/provider/claude-code.test.ts packages/server/src/provider/codex.test.ts packages/server/src/provider/opencode.test.ts
```

Expected: FAIL because provider `buildArgs` methods do not accept or use `yolo`.

- [ ] **Step 5: Implement Claude Code yolo args**

In `packages/server/src/provider/claude-code.ts`, change the `buildArgs` signature to:

```ts
  buildArgs(options: {
    model?: string;
    resume?: boolean;
    sessionId?: string;
    yolo?: boolean;
  }): string[] {
```

Add this block after the model block and before `return args;`:

```ts
    if (options.yolo) {
      args.push('--dangerously-skip-permissions');
    }
```

In `spawn`, pass `yolo: options.yolo` into `buildArgs`:

```ts
    const args = this.buildArgs({
      model: options.model,
      resume: options.resume,
      sessionId,
      yolo: options.yolo,
    });
```

- [ ] **Step 6: Implement Codex yolo args**

In `packages/server/src/provider/codex.ts`, add `yolo?: boolean;` to the `buildArgs` options type:

```ts
  buildArgs(options: {
    cwd: string;
    model?: string;
    resume?: boolean;
    providerSessionId?: string;
    yolo?: boolean;
  }): string[] {
```

Add this block after the model block and before the resume provider session id block:

```ts
    if (options.yolo) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }
```

In `spawn`, pass `yolo: options.yolo` into `buildArgs`:

```ts
    const args = this.buildArgs({
      cwd: options.cwd,
      model: options.model,
      resume: options.resume,
      providerSessionId: options.providerSessionId,
      yolo: options.yolo,
    });
```

- [ ] **Step 7: Implement OpenCode yolo args**

In `packages/server/src/provider/opencode.ts`, add `yolo?: boolean;` to the `buildArgs` options type:

```ts
  buildArgs(options: {
    cwd: string;
    model?: string;
    resume?: boolean;
    providerSessionId?: string;
    yolo?: boolean;
  }): string[] {
```

Replace the body of `buildArgs` with:

```ts
    if (options.yolo) {
      const args = [
        'run',
        '--interactive',
        '--dangerously-skip-permissions',
        '--dir',
        options.cwd,
      ];
      if (options.resume) {
        if (!options.providerSessionId) {
          throw new Error('OpenCode resume requires a provider session id');
        }
        args.push('--session', options.providerSessionId);
      }
      if (options.model) {
        args.push('--model', options.model);
      }
      return args;
    }

    const args = options.resume ? ['--session'] : [];
    if (options.resume) {
      if (!options.providerSessionId) {
        throw new Error('OpenCode resume requires a provider session id');
      }
      args.push(options.providerSessionId);
    }
    args.push(options.cwd);
    if (options.model) {
      args.push('--model', options.model);
    }
    return args;
```

In `spawn`, pass `yolo: options.yolo` into `buildArgs`:

```ts
    const args = this.buildArgs({
      cwd: options.cwd,
      model: options.model,
      resume: options.resume,
      providerSessionId: options.providerSessionId,
      yolo: options.yolo,
    });
```

- [ ] **Step 8: Run provider tests to verify they pass**

Run:

```bash
bunx vitest run packages/server/src/provider/claude-code.test.ts packages/server/src/provider/codex.test.ts packages/server/src/provider/opencode.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add packages/server/src/provider/claude-code.ts packages/server/src/provider/codex.ts packages/server/src/provider/opencode.ts packages/server/src/provider/claude-code.test.ts packages/server/src/provider/codex.test.ts packages/server/src/provider/opencode.test.ts
git commit -m "feat(providers): add yolo launch arguments"
```

---

### Task 4: Add Workspace Picker Yolo Control

**Files:**
- Modify: `packages/web/src/components/workspace/dir-picker.tsx`
- Modify: `packages/web/src/app.tsx`
- Test: `e2e/app.spec.ts`

- [ ] **Step 1: Write failing E2E tests for the picker**

In `e2e/app.spec.ts`, update `test('new session button opens workspace picker', ...)` by adding:

```ts
    await expect(page.getByRole('checkbox', { name: 'Yolo mode' })).toBeChecked();
```

after the OpenCode radio assertion.

Add this test after `test('workspace picker creates OpenCode sessions when OpenCode is selected', ...)`:

```ts
  test('workspace picker sends default and disabled yolo selections', async ({ page }) => {
    const defaultPath = mkdtempSync(join(tmpdir(), 'cubby-yolo-default-'));
    const disabledPath = mkdtempSync(join(tmpdir(), 'cubby-yolo-disabled-'));
    await installWebSocketRecorder(page);

    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'New Session' }).click();

      const defaultDialog = page.getByRole('dialog', { name: 'Open Workspace' });
      await expect(defaultDialog.getByRole('checkbox', { name: 'Yolo mode' })).toBeChecked();
      await defaultDialog.getByLabel('Workspace path').fill(defaultPath);
      await defaultDialog.getByRole('button', { name: 'Open', exact: true }).click();

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const commands =
                (
                  window as typeof window & {
                    __wsCommands?: Array<{ cmd?: string; args?: { yolo?: boolean } }>;
                  }
                ).__wsCommands ?? [];
              return commands.find((command) => command.cmd === 'session.create')?.args?.yolo;
            }),
          { timeout: 10000 },
        )
        .toBe(true);

      await page.evaluate(() => {
        (window as typeof window & { __wsCommands?: unknown[] }).__wsCommands = [];
      });

      await page.getByRole('button', { name: 'New Session' }).click();
      const disabledDialog = page.getByRole('dialog', { name: 'Open Workspace' });
      await disabledDialog.getByRole('checkbox', { name: 'Yolo mode' }).uncheck();
      await disabledDialog.getByLabel('Workspace path').fill(disabledPath);
      await disabledDialog.getByRole('button', { name: 'Open', exact: true }).click();

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const commands =
                (
                  window as typeof window & {
                    __wsCommands?: Array<{ cmd?: string; args?: { yolo?: boolean } }>;
                  }
                ).__wsCommands ?? [];
              return commands.find((command) => command.cmd === 'session.create')?.args?.yolo;
            }),
          { timeout: 10000 },
        )
        .toBe(false);
    } finally {
      rmSync(defaultPath, { recursive: true, force: true });
      rmSync(disabledPath, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run E2E test slice to verify it fails**

Run:

```bash
bun run build && CUBBY_MOCK_CLAUDE_PROVIDER=1 CUBBY_MOCK_CODEX_PROVIDER=1 CUBBY_MOCK_OPENCODE_PROVIDER=1 bunx playwright test e2e/app.spec.ts -g "workspace picker|new session button"
```

Expected: FAIL because the checkbox is missing and `session.create` does not include `yolo`.

- [ ] **Step 3: Add yolo to workspace picker state and output**

In `packages/web/src/components/workspace/dir-picker.tsx`, change `WorkspaceOpenSelection` to:

```ts
export interface WorkspaceOpenSelection {
  path: string;
  provider: AgentProviderId;
  yolo: boolean;
}
```

Add state after the provider state:

```ts
  const [yolo, setYolo] = useState(true);
```

In `handleSubmit`, change `onConfirm` to include yolo:

```ts
      onConfirm({ path: isBrowseResponse(data) ? data.path : path.trim(), provider, yolo });
```

Update the `handleSubmit` dependency list:

```ts
  }, [path, provider, yolo, onConfirm]);
```

- [ ] **Step 4: Render the yolo checkbox**

In `packages/web/src/components/workspace/dir-picker.tsx`, add this block after the provider radiogroup and before the workspace path input grid:

```tsx
        <label
          style={{
            marginBottom: '12px',
            minHeight: '34px',
            border: '1px solid #3a3a52',
            borderRadius: '6px',
            background: '#202033',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '0 10px',
            boxSizing: 'border-box',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              minWidth: 0,
              color: '#dce3ff',
              fontSize: '13px',
              fontWeight: 650,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Yolo mode
          </span>
          <input
            type="checkbox"
            aria-label="Yolo mode"
            checked={yolo}
            onChange={(event) => setYolo(event.target.checked)}
            style={{ margin: 0, accentColor: '#89b4fa', flexShrink: 0 }}
          />
        </label>
```

- [ ] **Step 5: Send yolo from App**

In `packages/web/src/app.tsx`, change `handleDirConfirm` destructuring:

```ts
    async ({ path: workspaceId, provider, yolo }: WorkspaceOpenSelection) => {
```

Change the create args:

```ts
        args: { workspaceId, provider, yolo },
```

- [ ] **Step 6: Run the E2E slice to verify it passes**

Run:

```bash
bun run build && CUBBY_MOCK_CLAUDE_PROVIDER=1 CUBBY_MOCK_CODEX_PROVIDER=1 CUBBY_MOCK_OPENCODE_PROVIDER=1 bunx playwright test e2e/app.spec.ts -g "workspace picker|new session button"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add packages/web/src/components/workspace/dir-picker.tsx packages/web/src/app.tsx e2e/app.spec.ts
git commit -m "feat(web): add session yolo picker"
```

---

### Task 5: Full Verification

**Files:**
- No source edits unless verification finds a regression.

- [ ] **Step 1: Run focused unit and integration tests**

Run:

```bash
bunx vitest run packages/server/src/session/store.test.ts packages/server/src/session/manager.test.ts packages/server/src/server.test.ts packages/server/src/ws/handler.test.ts packages/server/src/provider/claude-code.test.ts packages/server/src/provider/codex.test.ts packages/server/src/provider/opencode.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full unit test suite**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
bun run lint
```

Expected: PASS.

- [ ] **Step 4: Run the picker E2E slice**

Run:

```bash
CUBBY_MOCK_CLAUDE_PROVIDER=1 CUBBY_MOCK_CODEX_PROVIDER=1 CUBBY_MOCK_OPENCODE_PROVIDER=1 bunx playwright test e2e/app.spec.ts -g "workspace picker|new session button"
```

Expected: PASS.

- [ ] **Step 5: Inspect git state**

Run:

```bash
git status --short
```

Expected: no uncommitted source changes after Task 4 commit, unless verification produced test artifacts already ignored by git.

---

## Self-Review

Spec coverage:

- Session-level yolo persistence: Task 1.
- Default yolo enabled: Task 1 and Task 4.
- HTTP and WebSocket create support: Task 2.
- Start and resume provider propagation: Task 2.
- Claude Code, Codex, and OpenCode support: Task 3.
- OpenCode yolo direct interactive run path: Task 3.
- Workspace picker control: Task 4.
- Test-first execution and verification: Tasks 1 through 5.

Type consistency:

- The field is named `yolo` in `Session`, `CreateSessionInput`, `SpawnOptions`, HTTP create, WebSocket create, React selection state, and E2E assertions.
- Provider build arg tests use the same `yolo?: boolean` option that `SpawnOptions` exposes.
