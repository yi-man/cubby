# Cubby MVP: Agent Session + Terminal Output

## 目标

实现 Cubby 的核心功能：从任何浏览器（包括手机）启动和实时查看 AI Agent（Claude Code / Codex）的编码过程。

## MVP 范围

**包含：**
- Session 状态机（draft → starting → running → idle → ended）
- Provider 抽象 + Claude Code PTY 子进程
- PTY 终端系统（RingBuffer、二进制 WS 协议）
- WebSocket Hub（topic pub/sub、JSON 命令 + 二进制终端帧）
- SQLite 持久化（sessions、terminals 表）
- HTTP API（Session CRUD）
- 响应式 Web UI（xterm.js 终端、桌面/移动端适配）

**不包含（后续迭代）：**
- 认证系统
- Supervisor 系统
- 文件系统操作
- Git 集成
- CLI 工具
- LSP、Preview、Upload

## 架构

```
┌─────────────────────────────────────────────────┐
│                   Browser (手机/桌面)              │
│  ┌───────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ Session    │  │ Terminal   │  │ Responsive   │  │
│  │ List/Create│  │ (xterm.js) │  │ Shell        │  │
│  └─────┬─────┘  └─────┬─────┘  └──────────────┘  │
│        └──────┬───────┘                            │
│         WS Client (JSON commands + binary terminal)│
└───────────────┬────────────────────────────────────┘
                │
┌───────────────┴────────────────────────────────────┐
│                   Fastify Server                     │
│  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │ HTTP API      │  │ WebSocket Hub               │  │
│  │ POST /session │  │ - topic pub/sub             │  │
│  │ GET /session  │  │ - JSON commands             │  │
│  └──────┬───────┘  │ - binary terminal frames     │  │
│         │          └──────────┬──────────────────┘  │
│  ┌──────┴──────────────────────┴──────────────────┐ │
│  │           SessionManager (状态机)                │ │
│  │  draft → starting → running → idle → ended      │ │
│  └──────────────────────┬─────────────────────────┘ │
│  ┌──────────────────────┴─────────────────────────┐ │
│  │           Provider: Claude Code (PTY)           │ │
│  │  spawn("claude", args) → pty.stdout → RingBuffer│ │
│  └─────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────┐ │
│  │           SQLite (bun:sqlite)                    │ │
│  │  sessions / terminals tables                     │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## 核心类型

### Session 状态机

```
draft → starting → running → idle → ended
  ↑                      │       │
  └──────────────────────┘       │
  └──────────────────────────────┘  (restart)
```

- **draft**：刚创建，还没启动 agent
- **starting**：Provider 正在 spawn PTY 进程
- **running**：agent 正在输出
- **idle**：输出暂停超过阈值（默认 30s），等待用户输入或自动继续
- **ended**：进程退出

### SQLite 表

```sql
CREATE TABLE sessions (
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

CREATE TABLE terminals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT,
  pid INTEGER,
  cols INTEGER DEFAULT 80,
  rows INTEGER DEFAULT 24,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

## WebSocket 协议

### JSON 命令通道 (`/ws`)

```typescript
// 请求
{ id: string, cmd: string, args: {...} }
// 响应
{ id: string, ok: boolean, data?: {...}, error?: {...} }
// 事件推送
{ evt: string, data: {...} }
```

命令列表：
- `session.create` — 创建会话
- `session.start` — 启动 agent
- `session.kill` — 终止 agent
- `session.list` — 列出会话
- `terminal.subscribe` — 订阅终端输出
- `terminal.input` — 发送输入
- `terminal.resize` — 调整大小

### 二进制终端通道 (`/ws/terminal`)

```
[1 byte type][4 bytes terminal_id][4 bytes length][payload]
type: 0x01=output, 0x02=input, 0x03=resize
```

## Provider 接口

```typescript
interface AgentProvider {
  name: string;
  spawn(session: Session, options: SpawnOptions): Promise<AgentProcess>;
  kill(process: AgentProcess): Promise<void>;
}

interface AgentProcess {
  pty: IPty;
  ringBuffer: RingBuffer;
}

interface SpawnOptions {
  cwd: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}
```

Claude Code Provider 实现：
- `spawn`: 执行 `claude --model <model> --print` 命令，通过 PTY 捕获输出
- RingBuffer 存储最近 N 行输出，支持断线重连时回放

## 文件结构

### @cubby/core

```
src/
  types/
    session.ts
    terminal.ts
    provider.ts
    ws.ts
    error.ts
  protocol/
    binary.ts
    commands.ts
  index.ts
```

### @cubby/server

```
src/
  db/
    schema.ts
    index.ts
  session/
    manager.ts
    store.ts
  provider/
    types.ts
    claude-code.ts
    codex.ts
  terminal/
    host.ts
    ring-buffer.ts
  ws/
    hub.ts
    handler.ts
  http/
    routes.ts
  server.ts
```

### @cubby/web

```
src/
  hooks/
    use-ws.ts
  components/
    terminal/
      terminal.tsx
    session/
      session-list.tsx
      session-create.tsx
      session-view.tsx
  layouts/
    shell.tsx
  atoms/
    session.ts
  main.tsx
```

## 实现顺序

1. **@cubby/core** — types + protocol（其他包依赖它）
2. **@cubby/server: SQLite** — Database 类 + schema
3. **@cubby/server: RingBuffer** — 环形缓冲区
4. **@cubby/server: SessionManager** — 状态机 + store
5. **@cubby/server: Provider** — Claude Code PTY provider
6. **@cubby/server: WebSocket Hub** — 连接管理 + topic pub/sub
7. **@cubby/server: HTTP API** — session CRUD routes
8. **@cubby/server: 整合** — server.ts 启动串联所有组件
9. **@cubby/web: WS client** — WebSocket hook
10. **@cubby/web: Terminal** — xterm.js 组件
11. **@cubby/web: Session UI** — 列表、创建、查看
12. **@cubby/web: Shell** — 响应式布局
13. **联调** — 端到端验证
14. **测试** — 单元测试 + 集成测试

## 验证标准

- [ ] `bun run dev` 启动成功，server 监听 3000，web 监听 5173
- [ ] 浏览器打开 localhost:5173，看到 Cubby UI
- [ ] 创建 Session → 选择 Claude Code → 点击启动
- [ ] xterm.js 终端显示 claude CLI 的实时输出
- [ ] 手机浏览器访问同一地址，能正常使用
- [ ] 断开 WebSocket 重连后，终端内容回放恢复
- [ ] `bun run test` 通过
- [ ] `bun run lint` 通过
