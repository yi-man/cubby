# Cubby MVP: Agent Session + Terminal Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现从任何浏览器启动和实时查看 AI Agent（Claude Code / Codex）编码过程的核心功能。

**Architecture:** Provider 通过 PTY 子进程 spawn claude CLI，输出写入 RingBuffer，WebSocket Hub 推送到浏览器，xterm.js 渲染。Session 状态机管理生命周期，SQLite 持久化。

**Tech Stack:** Bun + Fastify 5 + React 19 + SQLite (bun:sqlite) + WebSocket + xterm.js + jotai

---

## Task 1: @cubby/core — 基础类型

**Files:**
- Create: `packages/core/src/types/error.ts`
- Create: `packages/core/src/types/session.ts`
- Create: `packages/core/src/types/terminal.ts`
- Create: `packages/core/src/types/provider.ts`
- Create: `packages/core/src/types/ws.ts`
- Create: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/index.ts`

### Step 1: StructuredError

```typescript
// packages/core/src/types/error.ts
export interface StructuredError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function createError(code: string, message: string, details?: Record<string, unknown>): StructuredError {
  return { code, message, details };
}
```

### Step 2: Session 类型

```typescript
// packages/core/src/types/session.ts
export const SESSION_STATUS = ['draft', 'starting', 'running', 'idle', 'ended'] as const;
export type SessionStatus = (typeof SESSION_STATUS)[number];

export interface Session {
  id: string;
  workspaceId: string;
  title: string | null;
  provider: string;
  model: string | null;
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
}
```

### Step 3: Terminal 类型

```typescript
// packages/core/src/types/terminal.ts
export interface Terminal {
  id: string;
  sessionId: string;
  title: string | null;
  pid: number | null;
  cols: number;
  rows: number;
  createdAt: string;
}

export interface TerminalOutput {
  terminalId: string;
  data: string;
  timestamp: number;
}
```

### Step 4: Provider 类型

```typescript
// packages/core/src/types/provider.ts
export interface SpawnOptions {
  cwd: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export interface AgentProvider {
  name: string;
  spawn(sessionId: string, options: SpawnOptions): Promise<AgentProcess>;
  kill(process: AgentProcess): Promise<void>;
}

export interface AgentProcess {
  pid: number;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}
```

### Step 5: WebSocket 协议类型

```typescript
// packages/core/src/types/ws.ts
export interface WSRequest {
  id: string;
  cmd: string;
  args?: Record<string, unknown>;
}

export interface WSResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface WSEvent {
  evt: string;
  data: unknown;
}

export type WSMessage = WSRequest | WSResponse | WSEvent;

export enum BinaryFrameType {
  OUTPUT = 0x01,
  INPUT = 0x02,
  RESIZE = 0x03,
}
```

### Step 6: 统一导出

```typescript
// packages/core/src/types/index.ts
export * from './error.js';
export * from './session.js';
export * from './terminal.js';
export * from './provider.js';
export * from './ws.js';
```

```typescript
// packages/core/src/index.ts
export * from './types/index.js';
```

### Step 7: 验证构建

```bash
cd packages/core && bun run build
```

Expected: 无报错，dist/ 下生成 .js 和 .d.ts 文件。

### Step 8: Commit

```bash
git add packages/core/src/
git commit -m "feat(core): add base types for session, terminal, provider, ws protocol"
```

---

## Task 2: @cubby/core — 二进制协议

**Files:**
- Create: `packages/core/src/protocol/binary.ts`
- Create: `packages/core/src/protocol/binary.test.ts`
- Modify: `packages/core/src/index.ts`

### Step 1: 写测试

```typescript
// packages/core/src/protocol/binary.test.ts
import { describe, expect, it } from 'vitest';
import { decodeBinaryFrame, encodeBinaryFrame, BinaryFrameType } from './binary.js';

describe('binary protocol', () => {
  it('encode and decode output frame', () => {
    const frame = encodeBinaryFrame(BinaryFrameType.OUTPUT, 'term-1', 'hello');
    const decoded = decodeBinaryFrame(frame);
    expect(decoded.type).toBe(BinaryFrameType.OUTPUT);
    expect(decoded.terminalId).toBe('term-1');
    expect(decoded.payload).toBe('hello');
  });

  it('encode and decode input frame', () => {
    const frame = encodeBinaryFrame(BinaryFrameType.INPUT, 'term-1', 'ls\n');
    const decoded = decodeBinaryFrame(frame);
    expect(decoded.type).toBe(BinaryFrameType.INPUT);
    expect(decoded.payload).toBe('ls\n');
  });

  it('encode and decode resize frame', () => {
    const payload = JSON.stringify({ cols: 120, rows: 40 });
    const frame = encodeBinaryFrame(BinaryFrameType.RESIZE, 'term-1', payload);
    const decoded = decodeBinaryFrame(frame);
    expect(decoded.type).toBe(BinaryFrameType.RESIZE);
    expect(JSON.parse(decoded.payload)).toEqual({ cols: 120, rows: 40 });
  });
});
```

### Step 2: 跑测试确认失败

```bash
bun run test -- packages/core/src/protocol/binary.test.ts
```

Expected: FAIL — module not found.

### Step 3: 实现

```typescript
// packages/core/src/protocol/binary.ts
import { BinaryFrameType } from '../types/ws.js';

export interface DecodedFrame {
  type: BinaryFrameType;
  terminalId: string;
  payload: string;
}

export function encodeBinaryFrame(type: BinaryFrameType, terminalId: string, payload: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const idBytes = encoder.encode(terminalId);
  const payloadBytes = encoder.encode(payload);
  // 1 byte type + 4 bytes id length + id bytes + 4 bytes payload length + payload bytes
  const buffer = new ArrayBuffer(1 + 4 + idBytes.length + 4 + payloadBytes.length);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  view.setUint8(0, type);
  view.setUint32(1, idBytes.length);
  uint8.set(idBytes, 5);
  view.setUint32(5 + idBytes.length, payloadBytes.length);
  uint8.set(payloadBytes, 9 + idBytes.length);

  return buffer;
}

export function decodeBinaryFrame(buffer: ArrayBuffer): DecodedFrame {
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);
  const decoder = new TextDecoder();

  const type = view.getUint8(0) as BinaryFrameType;
  const idLen = view.getUint32(1);
  const terminalId = decoder.decode(uint8.slice(5, 5 + idLen));
  const payloadLen = view.getUint32(5 + idLen);
  const payload = decoder.decode(uint8.slice(9 + idLen, 9 + idLen + payloadLen));

  return { type, terminalId, payload };
}
```

### Step 4: 导出

在 `packages/core/src/index.ts` 添加:
```typescript
export * from './protocol/binary.js';
```

### Step 5: 跑测试确认通过

```bash
bun run test -- packages/core/src/protocol/binary.test.ts
```

Expected: PASS.

### Step 6: Commit

```bash
git add packages/core/src/protocol/
git commit -m "feat(core): add binary frame encode/decode with tests"
```

---

## Task 3: @cubby/core — 命令定义

**Files:**
- Create: `packages/core/src/protocol/commands.ts`
- Modify: `packages/core/src/index.ts`

### Step 1: 实现

```typescript
// packages/core/src/protocol/commands.ts
export const WS_COMMANDS = {
  SESSION_CREATE: 'session.create',
  SESSION_START: 'session.start',
  SESSION_KILL: 'session.kill',
  SESSION_LIST: 'session.list',
  SESSION_GET: 'session.get',
  TERMINAL_SUBSCRIBE: 'terminal.subscribe',
  TERMINAL_UNSUBSCRIBE: 'terminal.unsubscribe',
  TERMINAL_INPUT: 'terminal.input',
  TERMINAL_RESIZE: 'terminal.resize',
} as const;

export type WSCommand = (typeof WS_COMMANDS)[keyof typeof WS_COMMANDS];

export const WS_EVENTS = {
  SESSION_STATUS: 'session.status',
  SESSION_CREATED: 'session.created',
  TERMINAL_OUTPUT: 'terminal.output',
  TERMINAL_EXIT: 'terminal.exit',
} as const;

export type WSEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
```

### Step 2: 导出

在 `packages/core/src/index.ts` 添加:
```typescript
export * from './protocol/commands.js';
```

### Step 3: 验证构建

```bash
cd packages/core && bun run build
```

### Step 4: Commit

```bash
git add packages/core/src/protocol/commands.ts packages/core/src/index.ts
git commit -m "feat(core): add ws command and event constants"
```

---

## Task 4: @cubby/server — SQLite Database

**Files:**
- Create: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/db/schema.test.ts`
- Create: `packages/server/src/db/index.ts`
- Create: `packages/server/src/db/index.test.ts`

### Step 1: 写 schema 测试

```typescript
// packages/server/src/db/schema.test.ts
import { describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from './schema.js';

describe('schema', () => {
  it('contains sessions table', () => {
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS sessions');
  });

  it('contains terminals table', () => {
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS terminals');
  });
});
```

### Step 2: 跑测试确认失败

```bash
bun run test -- packages/server/src/db/schema.test.ts
```

### Step 3: 实现 schema

```typescript
// packages/server/src/db/schema.ts
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  pid INTEGER,
  exit_code INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS terminals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT,
  pid INTEGER,
  cols INTEGER DEFAULT 80,
  rows INTEGER DEFAULT 24,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
`;
```

### Step 4: 跑测试确认通过

```bash
bun run test -- packages/server/src/db/schema.test.ts
```

### Step 5: 写 Database 类测试

```typescript
// packages/server/src/db/index.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Database } from './index.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

describe('Database', () => {
  let db: Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cubby-test-${Date.now()}.db`);
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it('creates tables on init', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('sessions');
    expect(names).toContain('terminals');
  });
});
```

### Step 6: 实现 Database 类

```typescript
// packages/server/src/db/index.ts
import { Database as BunDatabase } from 'bun:sqlite';
import { SCHEMA_SQL } from './schema.js';

export class Database {
  private db: BunDatabase;

  constructor(path: string) {
    this.db = new BunDatabase(path);
    this.db.run(SCHEMA_SQL);
  }

  prepare(sql: string) {
    return this.db.prepare(sql);
  }

  run(sql: string, params?: unknown[]) {
    if (params) {
      return this.db.run(sql, ...params);
    }
    return this.db.run(sql);
  }

  close() {
    this.db.close();
  }
}
```

### Step 7: 跑测试确认通过

```bash
bun run test -- packages/server/src/db/index.test.ts
```

### Step 8: Commit

```bash
git add packages/server/src/db/
git commit -m "feat(server): add SQLite database with sessions and terminals tables"
```

---

## Task 5: @cubby/server — RingBuffer

**Files:**
- Create: `packages/server/src/terminal/ring-buffer.ts`
- Create: `packages/server/src/terminal/ring-buffer.test.ts`

### Step 1: 写测试

```typescript
// packages/server/src/terminal/ring-buffer.test.ts
import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring-buffer.js';

describe('RingBuffer', () => {
  it('stores and retrieves lines', () => {
    const buf = new RingBuffer(100);
    buf.push('line1');
    buf.push('line2');
    expect(buf.getAll()).toEqual(['line1', 'line2']);
  });

  it('evicts oldest when full', () => {
    const buf = new RingBuffer(3);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    buf.push('d');
    expect(buf.getAll()).toEqual(['b', 'c', 'd']);
  });

  it('returns snapshot since given index', () => {
    const buf = new RingBuffer(100);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    const snapshot = buf.getSince(1);
    expect(snapshot).toEqual(['b', 'c']);
  });

  it('handles empty buffer', () => {
    const buf = new RingBuffer(100);
    expect(buf.getAll()).toEqual([]);
    expect(buf.getSince(0)).toEqual([]);
  });

  it('tracks current index', () => {
    const buf = new RingBuffer(100);
    expect(buf.currentIndex).toBe(0);
    buf.push('a');
    expect(buf.currentIndex).toBe(1);
    buf.push('b');
    expect(buf.currentIndex).toBe(2);
  });
});
```

### Step 2: 跑测试确认失败

```bash
bun run test -- packages/server/src/terminal/ring-buffer.test.ts
```

### Step 3: 实现

```typescript
// packages/server/src/terminal/ring-buffer.ts
export class RingBuffer {
  private buffer: string[];
  private maxSize: number;
  private index = 0;

  constructor(maxSize: number = 5000) {
    this.buffer = [];
    this.maxSize = maxSize;
  }

  push(line: string): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
    }
    this.buffer.push(line);
    this.index++;
  }

  getAll(): string[] {
    return [...this.buffer];
  }

  getSince(index: number): string[] {
    const start = index - (this.index - this.buffer.length);
    if (start < 0) return [...this.buffer];
    return this.buffer.slice(start);
  }

  get currentIndex(): number {
    return this.index;
  }
}
```

### Step 4: 跑测试确认通过

```bash
bun run test -- packages/server/src/terminal/ring-buffer.test.ts
```

### Step 5: Commit

```bash
git add packages/server/src/terminal/
git commit -m "feat(server): add RingBuffer for terminal output replay"
```

---

## Task 6: @cubby/server — SessionStore

**Files:**
- Create: `packages/server/src/session/store.ts`
- Create: `packages/server/src/session/store.test.ts`

### Step 1: 写测试

```typescript
// packages/server/src/session/store.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SessionStore } from './store.js';
import { Database } from '../db/index.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

describe('SessionStore', () => {
  let db: Database;
  let store: SessionStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cubby-test-${Date.now()}.db`);
    db = new Database(dbPath);
    store = new SessionStore(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it('creates a session', () => {
    const session = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
    expect(session.id).toBeTruthy();
    expect(session.status).toBe('draft');
    expect(session.provider).toBe('claude-code');
  });

  it('gets a session by id', () => {
    const created = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
    const found = store.get(created.id);
    expect(found?.id).toBe(created.id);
  });

  it('lists sessions', () => {
    store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
    store.create({ workspaceId: '/tmp/test', provider: 'codex' });
    const list = store.list();
    expect(list.length).toBe(2);
  });

  it('updates session status', () => {
    const session = store.create({ workspaceId: '/tmp/test', provider: 'claude-code' });
    store.updateStatus(session.id, 'running');
    const updated = store.get(session.id);
    expect(updated?.status).toBe('running');
  });

  it('returns null for non-existent session', () => {
    expect(store.get('nonexistent')).toBeNull();
  });
});
```

### Step 2: 跑测试确认失败

```bash
bun run test -- packages/server/src/session/store.test.ts
```

### Step 3: 实现

```typescript
// packages/server/src/session/store.ts
import { randomUUID } from 'node:crypto';
import type { Session, SessionStatus, CreateSessionInput } from '@cubby/core';
import type { Database } from '../db/index.js';

export class SessionStore {
  constructor(private db: Database) {}

  create(input: CreateSessionInput): Session {
    const id = randomUUID();
    const now = new Date().toISOString();
    const session: Session = {
      id,
      workspaceId: input.workspaceId,
      title: input.title ?? null,
      provider: input.provider,
      model: input.model ?? null,
      status: 'draft',
      pid: null,
      exitCode: null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };

    this.db.prepare(
      'INSERT INTO sessions (id, workspace_id, title, provider, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, session.workspaceId, session.title, session.provider, session.model, session.status, session.createdAt, session.updatedAt);

    return session;
  }

  get(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToSession(row);
  }

  list(): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToSession(r));
  }

  updateStatus(id: string, status: SessionStatus, extra?: { pid?: number; exitCode?: number }): void {
    const now = new Date().toISOString();
    if (status === 'ended') {
      this.db.prepare('UPDATE sessions SET status = ?, pid = ?, exit_code = ?, updated_at = ?, ended_at = ? WHERE id = ?')
        .run(status, extra?.pid ?? null, extra?.exitCode ?? null, now, now, id);
    } else {
      this.db.prepare('UPDATE sessions SET status = ?, pid = ?, updated_at = ? WHERE id = ?')
        .run(status, extra?.pid ?? null, now, id);
    }
  }

  private rowToSession(row: Record<string, unknown>): Session {
    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      title: row.title as string | null,
      provider: row.provider as string,
      model: row.model as string | null,
      status: row.status as SessionStatus,
      pid: row.pid as number | null,
      exitCode: row.exit_code as number | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      endedAt: row.ended_at as string | null,
    };
  }
}
```

### Step 4: 跑测试确认通过

```bash
bun run test -- packages/server/src/session/store.test.ts
```

### Step 5: Commit

```bash
git add packages/server/src/session/
git commit -m "feat(server): add SessionStore with CRUD operations"
```

---

## Task 7: @cubby/server — Claude Code Provider

**Files:**
- Create: `packages/server/src/provider/claude-code.ts`
- Create: `packages/server/src/provider/claude-code.test.ts`

### Step 1: 写测试

```typescript
// packages/server/src/provider/claude-code.test.ts
import { describe, expect, it } from 'vitest';
import { ClaudeCodeProvider } from './claude-code.js';

describe('ClaudeCodeProvider', () => {
  it('has correct name', () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.name).toBe('claude-code');
  });

  it('builds correct command args', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({ model: 'sonnet' });
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--print');
  });

  it('builds args without model', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({});
    expect(args).toContain('--print');
    expect(args).not.toContain('--model');
  });
});
```

### Step 2: 跑测试确认失败

```bash
bun run test -- packages/server/src/provider/claude-code.test.ts
```

### Step 3: 实现

```typescript
// packages/server/src/provider/claude-code.ts
import type { AgentProvider, AgentProcess, SpawnOptions } from '@cubby/core';
import { spawn } from 'node:child_process';
import { RingBuffer } from '../terminal/ring-buffer.js';

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = 'claude-code';

  buildArgs(options: { model?: string }): string[] {
    const args = ['--print'];
    if (options.model) {
      args.push('--model', options.model);
    }
    return args;
  }

  async spawn(
    sessionId: string,
    options: SpawnOptions,
    onOutput: (data: string) => void,
    onExit: (code: number) => void,
  ): Promise<AgentProcess & { ringBuffer: RingBuffer }> {
    const args = this.buildArgs({});
    const ringBuffer = new RingBuffer(5000);

    const child = spawn('claude', args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      ringBuffer.push(text);
      onOutput(text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      ringBuffer.push(text);
      onOutput(text);
    });

    child.on('exit', (code) => {
      onExit(code ?? 1);
    });

    const process: AgentProcess & { ringBuffer: RingBuffer } = {
      pid: child.pid!,
      onData: (cb) => { child.stdout?.on('data', (d: Buffer) => cb(d.toString())); },
      onExit: (cb) => { child.on('exit', (c) => cb(c ?? 1)); },
      write: (data) => { child.stdin?.write(data); },
      resize: () => {},
      kill: () => { child.kill('SIGTERM'); },
      ringBuffer,
    };

    return process;
  }

  async kill(process: AgentProcess): Promise<void> {
    process.kill();
  }
}
```

### Step 4: 跑测试确认通过

```bash
bun run test -- packages/server/src/provider/claude-code.test.ts
```

### Step 5: Commit

```bash
git add packages/server/src/provider/
git commit -m "feat(server): add Claude Code provider with PTY subprocess"
```

---

## Task 8: @cubby/server — SessionManager

**Files:**
- Create: `packages/server/src/session/manager.ts`
- Create: `packages/server/src/session/manager.test.ts`

### Step 1: 写测试

```typescript
// packages/server/src/session/manager.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from './manager.js';
import { SessionStore } from './store.js';
import { Database } from '../db/index.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

// Mock provider
function createMockProvider() {
  return {
    name: 'mock',
    async spawn(_sid: string, _opts: unknown, onOutput: (d: string) => void, onExit: (c: number) => void) {
      setTimeout(() => onOutput('hello from mock'), 10);
      setTimeout(() => onExit(0), 50);
      return {
        pid: 12345,
        onData: () => {},
        onExit: () => {},
        write: () => {},
        resize: () => {},
        kill: () => {},
      };
    },
    async kill() {},
  };
}

describe('SessionManager', () => {
  let db: Database;
  let store: SessionStore;
  let manager: SessionManager;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cubby-test-${Date.now()}.db`);
    db = new Database(dbPath);
    store = new SessionStore(db);
    manager = new SessionManager(store);
    manager.registerProvider(createMockProvider() as any);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it('creates a session', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    expect(session.status).toBe('draft');
  });

  it('starts a session', async () => {
    const outputs: string[] = [];
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }, (d) => outputs.push(d));
    const updated = store.get(session.id);
    expect(updated?.status).toBe('running');
    await new Promise(r => setTimeout(r, 100));
    expect(outputs.length).toBeGreaterThan(0);
  });

  it('rejects starting a non-draft session', async () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 });
    await expect(() =>
      manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 })
    ).rejects.toThrow('not in draft status');
  });
});
```

### Step 2: 跑测试确认失败

```bash
bun run test -- packages/server/src/session/manager.test.ts
```

### Step 3: 实现

```typescript
// packages/server/src/session/manager.ts
import type { Session, CreateSessionInput, AgentProvider, AgentProcess, SpawnOptions } from '@cubby/core';
import type { SessionStore } from './store.js';

export class SessionManager {
  private providers = new Map<string, AgentProvider>();
  private processes = new Map<string, AgentProcess & { ringBuffer: { getAll(): string[]; getSince(i: number): string[]; currentIndex: number } }>();

  constructor(private store: SessionStore) {}

  registerProvider(provider: AgentProvider): void {
    this.providers.set(provider.name, provider);
  }

  createSession(input: CreateSessionInput): Session {
    return this.store.create(input);
  }

  getSession(id: string): Session | null {
    return this.store.get(id);
  }

  listSessions(): Session[] {
    return this.store.list();
  }

  async startSession(
    sessionId: string,
    options: SpawnOptions,
    onOutput?: (data: string) => void,
  ): Promise<void> {
    const session = this.store.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status !== 'draft') throw new Error(`Session not in draft status: ${session.status}`);

    const provider = this.providers.get(session.provider);
    if (!provider) throw new Error(`Provider not found: ${session.provider}`);

    this.store.updateStatus(sessionId, 'starting');

    try {
      const process = await provider.spawn(sessionId, options, (data) => {
        this.store.updateStatus(sessionId, 'running');
        onOutput?.(data);
      }, (code) => {
        this.store.updateStatus(sessionId, 'ended', { exitCode: code, pid: process.pid });
        this.processes.delete(sessionId);
      });

      this.processes.set(sessionId, process);
      this.store.updateStatus(sessionId, 'running', { pid: process.pid });
    } catch (err) {
      this.store.updateStatus(sessionId, 'ended', { exitCode: 1 });
      throw err;
    }
  }

  async killSession(sessionId: string): Promise<void> {
    const process = this.processes.get(sessionId);
    if (process) {
      process.kill();
      this.processes.delete(sessionId);
    }
    this.store.updateStatus(sessionId, 'ended');
  }

  getProcess(sessionId: string) {
    return this.processes.get(sessionId);
  }
}
```

### Step 4: 跑测试确认通过

```bash
bun run test -- packages/server/src/session/manager.test.ts
```

### Step 5: Commit

```bash
git add packages/server/src/session/manager.ts packages/server/src/session/manager.test.ts
git commit -m "feat(server): add SessionManager with state machine and provider integration"
```

---

## Task 9: @cubby/server — WebSocket Hub

**Files:**
- Create: `packages/server/src/ws/hub.ts`
- Create: `packages/server/src/ws/hub.test.ts`

### Step 1: 写测试

```typescript
// packages/server/src/ws/hub.test.ts
import { describe, expect, it, vi } from 'vitest';
import { WebSocketHub } from './hub.js';

function createMockSocket() {
  const sent: unknown[] = [];
  return {
    readyState: 1, // OPEN
    send: vi.fn((data: string) => sent.push(data)),
    sent,
  };
}

describe('WebSocketHub', () => {
  it('subscribes and broadcasts to topic', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(ws as any, 'session:1');
    hub.broadcast('session:1', { evt: 'test', data: { ok: true } });
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.sent[0] as string)).toEqual({ evt: 'test', data: { ok: true } });
  });

  it('does not broadcast to unsubscribed', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(ws as any, 'session:1');
    hub.broadcast('session:2', { evt: 'test', data: {} });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('unsubscribes correctly', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(ws as any, 'session:1');
    hub.unsubscribe(ws as any, 'session:1');
    hub.broadcast('session:1', { evt: 'test', data: {} });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('removes all subscriptions on disconnect', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(ws as any, 'session:1');
    hub.subscribe(ws as any, 'session:2');
    hub.removeClient(ws as any);
    hub.broadcast('session:1', { evt: 'test', data: {} });
    hub.broadcast('session:2', { evt: 'test', data: {} });
    expect(ws.send).not.toHaveBeenCalled();
  });
});
```

### Step 2: 跑测试确认失败

```bash
bun run test -- packages/server/src/ws/hub.test.ts
```

### Step 3: 实现

```typescript
// packages/server/src/ws/hub.ts
import type { WebSocket } from 'ws';
import type { WSEvent } from '@cubby/core';

export class WebSocketHub {
  private topicClients = new Map<string, Set<WebSocket>>();
  private clientTopics = new Map<WebSocket, Set<string>>();

  subscribe(ws: WebSocket, topic: string): void {
    if (!this.topicClients.has(topic)) {
      this.topicClients.set(topic, new Set());
    }
    this.topicClients.get(topic)!.add(ws);

    if (!this.clientTopics.has(ws)) {
      this.clientTopics.set(ws, new Set());
    }
    this.clientTopics.get(ws)!.add(topic);
  }

  unsubscribe(ws: WebSocket, topic: string): void {
    this.topicClients.get(topic)?.delete(ws);
    this.clientTopics.get(ws)?.delete(topic);
  }

  broadcast(topic: string, event: WSEvent): void {
    const clients = this.topicClients.get(topic);
    if (!clients) return;
    const msg = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === 1) {
        ws.send(msg);
      }
    }
  }

  removeClient(ws: WebSocket): void {
    const topics = this.clientTopics.get(ws);
    if (topics) {
      for (const topic of topics) {
        this.topicClients.get(topic)?.delete(ws);
      }
      this.clientTopics.delete(ws);
    }
  }
}
```

### Step 4: 跑测试确认通过

```bash
bun run test -- packages/server/src/ws/hub.test.ts
```

### Step 5: Commit

```bash
git add packages/server/src/ws/
git commit -m "feat(server): add WebSocketHub with topic pub/sub"
```

---

## Task 10: @cubby/server — WS 命令处理器

**Files:**
- Create: `packages/server/src/ws/handler.ts`

### Step 1: 实现

```typescript
// packages/server/src/ws/handler.ts
import type { WSRequest, WSResponse } from '@cubby/core';
import { WS_COMMANDS } from '@cubby/core';
import type { SessionManager } from '../session/manager.js';
import type { WebSocketHub } from './hub.js';
import type { WebSocket } from 'ws';

export class WSCommandHandler {
  constructor(
    private sessionManager: SessionManager,
    private hub: WebSocketHub,
  ) {}

  async handle(ws: WebSocket, request: WSRequest): Promise<WSResponse> {
    try {
      switch (request.cmd) {
        case WS_COMMANDS.SESSION_CREATE:
          return this.sessionCreate(request);
        case WS_COMMANDS.SESSION_START:
          return this.sessionStart(ws, request);
        case WS_COMMANDS.SESSION_KILL:
          return this.sessionKill(request);
        case WS_COMMANDS.SESSION_LIST:
          return this.sessionList();
        case WS_COMMANDS.SESSION_GET:
          return this.sessionGet(request);
        case WS_COMMANDS.TERMINAL_SUBSCRIBE:
          return this.terminalSubscribe(ws, request);
        default:
          return { id: request.id, ok: false, error: { code: 'UNKNOWN_CMD', message: `Unknown command: ${request.cmd}` } };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { id: request.id, ok: false, error: { code: 'INTERNAL', message } };
    }
  }

  private sessionCreate(req: WSRequest): WSResponse {
    const { workspaceId, provider, model, title } = req.args as { workspaceId: string; provider: string; model?: string; title?: string };
    const session = this.sessionManager.createSession({ workspaceId, provider, model, title });
    return { id: req.id, ok: true, data: session };
  }

  private async sessionStart(ws: WebSocket, req: WSRequest): Promise<WSResponse> {
    const { sessionId, cwd } = req.args as { sessionId: string; cwd: string };
    const topic = `terminal:${sessionId}`;
    this.hub.subscribe(ws, topic);

    await this.sessionManager.startSession(
      sessionId,
      { cwd, cols: 80, rows: 24 },
      (data) => {
        this.hub.broadcast(topic, { evt: 'terminal.output', data: { sessionId, data } });
      },
    );

    return { id: req.id, ok: true, data: { sessionId } };
  }

  private sessionKill(req: WSRequest): WSResponse {
    const { sessionId } = req.args as { sessionId: string };
    this.sessionManager.killSession(sessionId);
    return { id: req.id, ok: true };
  }

  private sessionList(): WSResponse {
    const sessions = this.sessionManager.listSessions();
    return { id: 'list', ok: true, data: sessions };
  }

  private sessionGet(req: WSRequest): WSResponse {
    const { sessionId } = req.args as { sessionId: string };
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return { id: req.id, ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } };
    return { id: req.id, ok: true, data: session };
  }

  private terminalSubscribe(ws: WebSocket, req: WSRequest): WSResponse {
    const { sessionId } = req.args as { sessionId: string };
    const topic = `terminal:${sessionId}`;
    this.hub.subscribe(ws, topic);
    return { id: req.id, ok: true };
  }
}
```

### Step 2: Commit

```bash
git add packages/server/src/ws/handler.ts
git commit -m "feat(server): add WS command handler for session and terminal operations"
```

---

## Task 11: @cubby/server — HTTP Routes

**Files:**
- Create: `packages/server/src/http/routes.ts`

### Step 1: 实现

```typescript
// packages/server/src/http/routes.ts
import type { FastifyInstance } from 'fastify';
import type { SessionManager } from '../session/manager.js';

export function registerRoutes(app: FastifyInstance, sessionManager: SessionManager) {
  app.get('/api/sessions', async () => {
    return sessionManager.listSessions();
  });

  app.get('/api/sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const session = sessionManager.getSession(id);
    if (!session) {
      return { error: 'Not found' };
    }
    return session;
  });

  app.post('/api/sessions', async (request) => {
    const body = request.body as { workspaceId?: string; provider?: string; model?: string; title?: string };
    const session = sessionManager.createSession({
      workspaceId: body.workspaceId ?? process.cwd(),
      provider: body.provider ?? 'claude-code',
      model: body.model,
      title: body.title,
    });
    return session;
  });

  app.post('/api/sessions/:id/start', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { cwd?: string } | undefined;
    await sessionManager.startSession(id, {
      cwd: body?.cwd ?? process.cwd(),
      cols: 80,
      rows: 24,
    });
    return { ok: true };
  });

  app.post('/api/sessions/:id/kill', async (request) => {
    const { id } = request.params as { id: string };
    await sessionManager.killSession(id);
    return { ok: true };
  });
}
```

### Step 2: Commit

```bash
git add packages/server/src/http/
git commit -m "feat(server): add HTTP REST API routes for session CRUD"
```

---

## Task 12: @cubby/server — Server 整合

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/index.ts`

### Step 1: 重写 server.ts

```typescript
// packages/server/src/server.ts
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { Database } from './db/index.js';
import { SessionStore } from './session/store.js';
import { SessionManager } from './session/manager.js';
import { ClaudeCodeProvider } from './provider/claude-code.js';
import { WebSocketHub } from './ws/hub.js';
import { WSCommandHandler } from './ws/handler.js';
import { registerRoutes } from './http/routes.js';
import type { WSRequest } from '@cubby/core';
import { join } from 'node:path';

export async function createServer(port = 3000) {
  const app = Fastify({ logger: true });

  // Plugins
  await app.register(fastifyWebsocket);
  await app.register(fastifyCors, { origin: true });

  // Database
  const dbPath = join(process.cwd(), '.cubby', 'cubby.db');
  const db = new Database(dbPath);

  // Core services
  const sessionStore = new SessionStore(db);
  const sessionManager = new SessionManager(sessionStore);
  sessionManager.registerProvider(new ClaudeCodeProvider());

  const hub = new WebSocketHub();
  const wsHandler = new WSCommandHandler(sessionManager, hub);

  // HTTP routes
  registerRoutes(app, sessionManager);
  app.get('/healthz', async () => ({ status: 'ok' }));

  // WebSocket
  app.register(async function wsRoutes(fastify) {
    fastify.get('/ws', { websocket: true }, (socket) => {
      socket.on('message', async (raw) => {
        try {
          const request = JSON.parse(raw.toString()) as WSRequest;
          const response = await wsHandler.handle(socket, request);
          socket.send(JSON.stringify(response));
        } catch (err) {
          socket.send(JSON.stringify({ id: 'error', ok: false, error: { code: 'PARSE_ERROR', message: 'Invalid JSON' } }));
        }
      });

      socket.on('close', () => {
        hub.removeClient(socket);
      });
    });
  });

  // Graceful shutdown
  app.addHook('onClose', async () => {
    db.close();
  });

  return { app, port };
}
```

### Step 2: 更新 index.ts

```typescript
// packages/server/src/index.ts
export { createServer } from './server.js';

// Start if run directly
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { app, port } = await createServer(3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Cubby server listening on http://0.0.0.0:${port}`);
}
```

### Step 3: 验证 server 启动

```bash
bun run --filter @cubby/server build
cd packages/server && timeout 5 bun src/index.ts || true
```

Expected: Server starts, logs "listening on http://0.0.0.0:3000".

### Step 4: Commit

```bash
git add packages/server/src/server.ts packages/server/src/index.ts
git commit -m "feat(server): integrate all server components with WebSocket and HTTP"
```

---

## Task 13: @cubby/web — WebSocket Client Hook

**Files:**
- Create: `packages/web/src/hooks/use-ws.ts`
- Create: `packages/web/src/hooks/use-ws.test.ts`

### Step 1: 写测试

```typescript
// packages/web/src/hooks/use-ws.test.ts
import { describe, expect, it } from 'vitest';
import { parseWSMessage, serializeWSRequest } from './use-ws.js';

describe('WS utils', () => {
  it('serializes request', () => {
    const msg = serializeWSRequest({ id: '1', cmd: 'session.list' });
    const parsed = JSON.parse(msg);
    expect(parsed.id).toBe('1');
    expect(parsed.cmd).toBe('session.list');
  });

  it('parses response', () => {
    const msg = JSON.stringify({ id: '1', ok: true, data: [] });
    const parsed = parseWSMessage(msg);
    expect(parsed).toEqual({ id: '1', ok: true, data: [] });
  });

  it('parses event', () => {
    const msg = JSON.stringify({ evt: 'terminal.output', data: { data: 'hello' } });
    const parsed = parseWSMessage(msg);
    expect(parsed).toEqual({ evt: 'terminal.output', data: { data: 'hello' } });
  });
});
```

### Step 2: 实现

```typescript
// packages/web/src/hooks/use-ws.ts
import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSRequest, WSResponse, WSEvent } from '@cubby/core';

export function serializeWSRequest(req: WSRequest): string {
  return JSON.stringify(req);
}

export function parseWSMessage(raw: string): WSResponse | WSEvent {
  return JSON.parse(raw);
}

type MessageHandler = (msg: WSResponse | WSEvent) => void;

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(new Set<MessageHandler>());
  const [connected, setConnected] = useState(false);

  const send = useCallback((req: WSRequest) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(serializeWSRequest(req));
    }
  }, []);

  const onMessage = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const msg = parseWSMessage(e.data);
      for (const handler of handlersRef.current) {
        handler(msg);
      }
    };

    return () => { ws.close(); };
  }, [url]);

  return { send, onMessage, connected };
}
```

### Step 3: 跑测试确认通过

```bash
bun run test -- packages/web/src/hooks/use-ws.test.ts
```

### Step 4: Commit

```bash
git add packages/web/src/hooks/
git commit -m "feat(web): add WebSocket client hook"
```

---

## Task 14: @cubby/web — Terminal 组件

**Files:**
- Create: `packages/web/src/components/terminal/terminal.tsx`

### Step 1: 实现

```typescript
// packages/web/src/components/terminal/terminal.tsx
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export function TerminalView({ onData, onResize }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;

    if (onData) {
      term.onData((data) => onData(data));
    }

    if (onResize) {
      term.onResize(({ cols, rows }) => onResize(cols, rows));
    }

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: '200px' }}
    />
  );
}

export function useTerminalOutput(terminalRef: Terminal | null, output: string) {
  useEffect(() => {
    if (terminalRef && output) {
      terminalRef.write(output);
    }
  }, [terminalRef, output]);
}
```

### Step 2: Commit

```bash
git add packages/web/src/components/terminal/
git commit -m "feat(web): add Terminal component with xterm.js and fit addon"
```

---

## Task 15: @cubby/web — Session UI

**Files:**
- Create: `packages/web/src/atoms/session.ts`
- Create: `packages/web/src/components/session/session-list.tsx`
- Create: `packages/web/src/components/session/session-view.tsx`

### Step 1: jotai atoms

```typescript
// packages/web/src/atoms/session.ts
import { atom } from 'jotai';
import type { Session } from '@cubby/core';

export const sessionsAtom = atom<Session[]>([]);
export const currentSessionIdAtom = atom<string | null>(null);
export const currentSessionAtom = atom((get) => {
  const id = get(currentSessionIdAtom);
  if (!id) return null;
  return get(sessionsAtom).find((s) => s.id === id) ?? null;
});
```

### Step 2: SessionList 组件

```typescript
// packages/web/src/components/session/session-list.tsx
import type { Session } from '@cubby/core';

interface SessionListProps {
  sessions: Session[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function SessionList({ sessions, currentId, onSelect, onCreate }: SessionListProps) {
  return (
    <div style={{ padding: '8px', borderRight: '1px solid #333', height: '100%', overflowY: 'auto' }}>
      <button onClick={onCreate} style={{ width: '100%', marginBottom: '8px', padding: '8px' }}>
        + New Session
      </button>
      {sessions.map((s) => (
        <div
          key={s.id}
          onClick={() => onSelect(s.id)}
          style={{
            padding: '8px',
            cursor: 'pointer',
            background: s.id === currentId ? '#2a2a3e' : 'transparent',
            borderRadius: '4px',
            marginBottom: '4px',
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{s.title ?? s.provider}</div>
          <div style={{ fontSize: '12px', color: '#888' }}>{s.status}</div>
        </div>
      ))}
    </div>
  );
}
```

### Step 3: SessionView 组件

```typescript
// packages/web/src/components/session/session-view.tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import type { Session, WSEvent } from '@cubby/core';
import { TerminalView } from '../terminal/terminal.js';

interface SessionViewProps {
  session: Session;
  send: (req: { id: string; cmd: string; args?: Record<string, unknown> }) => void;
  onMessage: (handler: (msg: unknown) => void) => () => void;
}

export function SessionView({ session, send, onMessage }: SessionViewProps) {
  const [output, setOutput] = useState('');
  const termRef = useRef<any>(null);

  useEffect(() => {
    const unsub = onMessage((msg: any) => {
      if (msg.evt === 'terminal.output' && msg.data?.sessionId === session.id) {
        setOutput((prev) => prev + msg.data.data);
      }
    });
    return unsub;
  }, [session.id, onMessage]);

  useEffect(() => {
    if (output && termRef.current) {
      termRef.current.write(output);
      setOutput('');
    }
  }, [output]);

  const handleStart = useCallback(() => {
    send({ id: 'start', cmd: 'session.start', args: { sessionId: session.id, cwd: process.env.CWD ?? '/' } });
  }, [session.id, send]);

  const handleKill = useCallback(() => {
    send({ id: 'kill', cmd: 'session.kill', args: { sessionId: session.id } });
  }, [session.id, send]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px', borderBottom: '1px solid #333', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold' }}>{session.title ?? session.provider}</span>
        <span style={{ color: '#888', fontSize: '12px' }}>{session.status}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          {session.status === 'draft' && (
            <button onClick={handleStart} style={{ padding: '4px 12px' }}>Start</button>
          )}
          {(session.status === 'running' || session.status === 'starting') && (
            <button onClick={handleKill} style={{ padding: '4px 12px', color: 'red' }}>Kill</button>
          )}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <TerminalView />
      </div>
    </div>
  );
}
```

### Step 4: Commit

```bash
git add packages/web/src/atoms/ packages/web/src/components/session/
git commit -m "feat(web): add session list, session view, and jotai atoms"
```

---

## Task 16: @cubby/web — App Shell & 主入口

**Files:**
- Create: `packages/web/src/app.tsx`
- Modify: `packages/web/src/main.tsx`

### Step 1: App 组件

```typescript
// packages/web/src/app.tsx
import { useState, useCallback, useEffect } from 'react';
import { useAtom } from 'jotai';
import type { Session, WSResponse, WSEvent } from '@cubby/core';
import { useWebSocket } from './hooks/use-ws.js';
import { sessionsAtom, currentSessionIdAtom } from './atoms/session.js';
import { SessionList } from './components/session/session-list.js';
import { SessionView } from './components/session/session-view.js';

export function App() {
  const { send, onMessage, connected } = useWebSocket('ws://localhost:3000/ws');
  const [sessions, setSessions] = useAtom(sessionsAtom);
  const [currentId, setCurrentId] = useAtom(currentSessionIdAtom);
  const currentSession = sessions.find((s) => s.id === currentId) ?? null;

  // Load sessions on connect
  useEffect(() => {
    if (connected) {
      send({ id: 'init', cmd: 'session.list' });
    }
  }, [connected, send]);

  // Handle responses
  useEffect(() => {
    return onMessage((msg: any) => {
      if (msg.ok && msg.id === 'init' && Array.isArray(msg.data)) {
        setSessions(msg.data);
      }
      if (msg.ok && msg.id === 'create' && msg.data) {
        setSessions((prev) => [msg.data, ...prev]);
        setCurrentId(msg.data.id);
      }
      if (msg.evt === 'session.status') {
        setSessions((prev) =>
          prev.map((s) => (s.id === msg.data.sessionId ? { ...s, status: msg.data.status } : s))
        );
      }
    });
  }, [onMessage, setSessions, setCurrentId]);

  const handleCreate = useCallback(() => {
    send({ id: 'create', cmd: 'session.create', args: { workspaceId: '/', provider: 'claude-code' } });
  }, [send]);

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#1e1e2e', color: '#cdd6f4', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: '240px', flexShrink: 0 }}>
        <SessionList
          sessions={sessions}
          currentId={currentId}
          onSelect={setCurrentId}
          onCreate={handleCreate}
        />
      </div>
      <div style={{ flex: 1 }}>
        {currentSession ? (
          <SessionView session={currentSession} send={send} onMessage={onMessage} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>
            Select or create a session
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 2: 更新 main.tsx

```typescript
// packages/web/src/main.tsx
import { createRoot } from 'react-dom/client';
import { Provider } from 'jotai';
import { App } from './app.js';

createRoot(document.getElementById('root')!).render(
  <Provider>
    <App />
  </Provider>
);
```

### Step 3: Commit

```bash
git add packages/web/src/app.tsx packages/web/src/main.tsx
git commit -m "feat(web): add App shell with session list and terminal view"
```

---

## Task 17: 修复 dev script

**Files:**
- Modify: `scripts/dev.ts`

### Step 1: 修复

```typescript
// scripts/dev.ts
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const server = spawn('bun', ['--watch', 'packages/server/src/index.ts'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: true,
});

const web = spawn('bunx', ['vite'], {
  cwd: join(process.cwd(), 'packages/web'),
  stdio: 'inherit',
  shell: true,
});

process.on('SIGINT', () => {
  server.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exit(0);
});
```

### Step 2: 验证

```bash
bun run dev
```

Expected: Server 启动在 3000，Vite 启动在 5173。

### Step 3: Commit

```bash
git add scripts/dev.ts
git commit -m "fix: add missing join import in dev script"
```

---

## Task 18: 集成测试

**Files:**
- Create: `packages/server/src/integration.test.ts`

### Step 1: 端到端集成测试

```typescript
// packages/server/src/integration.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Database } from './db/index.js';
import { SessionStore } from './session/store.js';
import { SessionManager } from './session/manager.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

describe('Integration: SessionManager + SessionStore + Database', () => {
  let db: Database;
  let store: SessionStore;
  let manager: SessionManager;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cubby-integration-${Date.now()}.db`);
    db = new Database(dbPath);
    store = new SessionStore(db);
    manager = new SessionManager(store);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it('full lifecycle: create → start → output → kill', async () => {
    // Register mock provider
    manager.registerProvider({
      name: 'mock',
      async spawn(_sid, _opts, onOutput, onExit) {
        setTimeout(() => onOutput('hello'), 10);
        setTimeout(() => onExit(0), 100);
        return {
          pid: 999,
          onData: () => {},
          onExit: () => {},
          write: () => {},
          resize: () => {},
          kill: () => {},
        };
      },
      async kill() {},
    } as any);

    // Create
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    expect(session.status).toBe('draft');

    // Start
    const outputs: string[] = [];
    await manager.startSession(session.id, { cwd: '/tmp', cols: 80, rows: 24 }, (d) => outputs.push(d));

    const running = manager.getSession(session.id);
    expect(running?.status).toBe('running');

    // Wait for output
    await new Promise((r) => setTimeout(r, 50));
    expect(outputs).toContain('hello');

    // Kill
    await manager.killSession(session.id);
    const ended = manager.getSession(session.id);
    expect(ended?.status).toBe('ended');
  });

  it('persists sessions across store instances', () => {
    const session = manager.createSession({ workspaceId: '/tmp', provider: 'mock' });
    const store2 = new SessionStore(db);
    const found = store2.get(session.id);
    expect(found?.id).toBe(session.id);
  });
});
```

### Step 2: 跑测试

```bash
bun run test -- packages/server/src/integration.test.ts
```

Expected: PASS.

### Step 3: Commit

```bash
git add packages/server/src/integration.test.ts
git commit -m "test(server): add integration tests for session lifecycle"
```

---

## Task 19: 全量验证

### Step 1: 跑所有测试

```bash
bun run test
```

Expected: 所有测试通过。

### Step 2: 跑 lint

```bash
bun run lint
```

Expected: 无报错。如有问题：

```bash
bun run lint:fix
```

### Step 3: 构建

```bash
bun run build
```

Expected: 所有包构建成功。

### Step 4: 启动验证

```bash
bun run dev
```

Expected:
- Server 监听 3000
- Vite dev server 监听 5173
- 浏览器打开 localhost:5173 看到 Cubby UI

### Step 5: 端到端验证

1. 打开浏览器 localhost:5173
2. 点击 "+ New Session"
3. 在 session list 中看到新 session（status: draft）
4. 点击 "Start"
5. 终端显示 claude CLI 输出
6. 手机浏览器访问同一地址，验证响应式布局

### Step 6: Commit（如有修复）

```bash
git add -A
git commit -m "chore: final integration fixes"
```

---

## 总结

| Task | 组件 | 内容 |
|------|------|------|
| 1-3 | @cubby/core | 类型定义、二进制协议、命令常量 |
| 4 | @cubby/server | SQLite 数据库 |
| 5 | @cubby/server | RingBuffer 环形缓冲区 |
| 6 | @cubby/server | SessionStore CRUD |
| 7 | @cubby/server | Claude Code Provider |
| 8 | @cubby/server | SessionManager 状态机 |
| 9 | @cubby/server | WebSocket Hub |
| 10 | @cubby/server | WS 命令处理器 |
| 11 | @cubby/server | HTTP API 路由 |
| 12 | @cubby/server | Server 整合启动 |
| 13 | @cubby/web | WebSocket 客户端 hook |
| 14 | @cubby/web | xterm.js Terminal 组件 |
| 15 | @cubby/web | Session UI（列表、查看） |
| 16 | @cubby/web | App Shell 入口 |
| 17 | 修复 | dev script 缺失 import |
| 18 | 测试 | 集成测试 |
| 19 | 验证 | 全量构建、lint、端到端验证 |
