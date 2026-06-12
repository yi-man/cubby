# Cubby — 开发计划

## 总览

共 7 个阶段，预估 10-12 周完成 P0 + 部分 P1。每个阶段必须通过验收才能进入下一阶段。

**测试策略：** 边开发边写测试，不攒到最后。每个阶段包含对应的单元测试和集成测试。

> **当前路线更新（2026-06-11）：** Cubby 已重新定位为自托管的个人 AI 编码工作台，而不是浏览器版 VS Code。近期开发优先级以 `docs/ROADMAP.md` 为准：远程访问安全、CLI 服务管理、WebSocket 可靠重连、端口预览、Git diff、文件查看和 runtime diagnostics。下面的阶段计划保留为历史完整规划，涉及内置文件写入、完整 Git 写操作 UI、多 Tab fencing、完整 IDE/LSP、workspace intelligence、session review、verification runs 和 supervisor 的内容不再作为近期核心。

---

## Phase 0: 项目骨架 + 基础设施（3 天）

**目标：** monorepo 搭建、构建工具链、测试基础设施、数据模型。

### 任务

**Monorepo 搭建：**
- [ ] 初始化 bun workspace monorepo
- [ ] 创建 packages/core、server、web、providers、cli
- [ ] 配置 TypeScript（tsconfig.base.json + 各包 tsconfig，strict mode）
  - 依赖版本：TypeScript 5.x（稳定版）
- [ ] 配置 Biome v2（lint + format，pre-commit hook）
- [ ] 配置 Vite 6.x（web 包，React plugin）
  - 手动 chunk 策略：`monaco-editor` 和 `xterm` 单独 chunk（两者体积大，分离可优化首屏加载）
  - 配置 `build.rollupOptions.output.manualChunks`
- [ ] 配置 Vitest（单元/集成测试，jsdom 环境，各包独立 config）
- [ ] 配置 Playwright（E2E 测试骨架）
- [ ] 配置 dev 脚本：并行启动 server + web dev（类似 coder-studio 的 `tsx scripts/dev.ts`）
  - server 包用 `bun --watch` 热重载
  - web 包用 Vite dev server（默认 5173 端口）
  - server 代理 `/ws` 和 API 路由到前端 dev server

**core 包基础类型：**
- [ ] Domain 类型定义：Workspace、Session、Terminal、Provider
- [ ] Session 状态机类型：draft / starting / running / idle / ended
- [ ] WebSocket 协议消息类型（ClientMessage / ServerMessage）
- [ ] 二进制帧格式定义（16 字节帧头：version, type, flags, meta, streamId, payloadSize）
  - 帧类型：Output(1)、Replay(2)、Input(3)、Snapshot(4)
  - Output v2 嵌入 topic string 和序列号
- [ ] Topic 常量定义
- [ ] EventBus 事件类型定义
- [ ] ProviderDefinition 接口
- [ ] 错误类型定义（StructuredError: code / message / details）

**server 包骨架：**
- [ ] Fastify 应用初始化（logger、cors、compress、static、websocket）
- [ ] 命令注册机制：registerCommand(op, schema, handler)
- [ ] 错误处理中间件（ZodError 标准化、StructuredError）
- [ ] SQLite 初始化（bun:sqlite，建表脚本）

**web 包骨架：**
- [ ] React 应用初始化（路由、Jotai Provider）
- [ ] WebSocket 客户端骨架（连接、命令 dispatch、topic 订阅）
- [ ] Shell 组件占位（Desktop + Mobile）

**cli 包骨架：**
- [ ] `cubby --version` / `cubby --help`

**SQLite Schema 设计：**
```sql
-- sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  config_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);

-- session_metadata
CREATE TABLE session_metadata (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  objective TEXT,
  baseline_git_head TEXT,
  verification_runs_json TEXT
);

-- terminals
CREATE TABLE terminals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL DEFAULT 'shell',
  cols INTEGER NOT NULL DEFAULT 80,
  rows INTEGER NOT NULL DEFAULT 24,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);

-- workspaces
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  ui_state_json TEXT,
  created_at INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL
);

-- settings (key-value)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

-- custom_providers
CREATE TABLE custom_providers (
  id TEXT PRIMARY KEY,
  definition_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- auth_sessions
CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- auth_login_blocks
CREATE TABLE auth_login_blocks (
  ip TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER
);

-- provider_configs
CREATE TABLE provider_configs (
  provider_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  PRIMARY KEY (provider_id, key)
);
```

**单元测试：**
- [ ] 类型编译测试（所有类型可正常 import 和使用）
- [ ] 错误类型测试（StructuredError 创建和序列化）

**验收：**
- `bun install` 无报错
- `bun run dev` 启动 server + web
- 浏览器打开看到占位页面
- `bun run test` 通过（含空测试套件）
- SQLite 建表成功，可 CRUD

---

## Phase 1: 终端系统（1.5 周）

**目标：** 浏览器内真实终端可交互，含完整的重连和恢复机制。

### 任务

**server — Terminal Manager：**
- [ ] PtyHost：bun-pty 封装（spawn / write / resize / kill / onExit / onData）
- [ ] TerminalManager：进程生命周期管理
  - create(workspaceId, options) → Terminal
  - close(terminalId)
  - write(terminalId, data)
  - resize(terminalId, cols, rows)
  - getTerminal(terminalId) / listTerminals(workspaceId)
- [ ] RingBuffer：环形缓冲区
  - 容量 10000 行
  - write(data) / read(fromSeq?) / getSnapshot()
  - 序列号递增
- [ ] HeadlessSnapshotBuffer：无头 xterm.js 实例
  - 序列化完整终端状态（光标位置、样式、滚动位置等）
  - 用于 `terminal.snapshot` 命令
  - 与 RingBuffer 互补：RingBuffer 用于 replay，HeadlessSnapshot 用于完整状态恢复
- [ ] 终端色彩环境配置：
  - 强制 `TERM=xterm-256color`、`COLORTERM=truecolor`、`FORCE_COLOR=3`
  - 从主题背景色 hex 推导 `COLORFGBG` 环境变量
- [ ] 终端类型：agent（绑定 session）和 shell（独立）

**server — WebSocket 二进制协议：**
- [ ] 帧格式编解码：16 字节帧头 `[version:1][type:1][flags:1][meta:1][streamId:4][payloadSize:8][payload]`
- [ ] 帧类型：Output(1)、Replay(2)、Input(3)、Snapshot(4)
- [ ] Output v2 帧：嵌入 topic string + 序列号
- [ ] Input 双帧握手：JSON 命令帧 → 等待二进制 payload 帧（5 秒超时）
- [ ] 二进制帧路由到对应 terminal

**server — 终端命令（7 个）：**
- [ ] `terminal.list` — 列出工作区所有终端
- [ ] `terminal.create` — 创建 shell 终端（自定义 cwd、cols/rows）
- [ ] `terminal.replay` — 从指定 seq 重放输出（二进制传输）
- [ ] `terminal.snapshot` — 获取终端快照（二进制传输）
- [ ] `terminal.close` — 关闭终端
- [ ] `terminal.input` — 发送输入（二进制传输 + 活动追踪）
- [ ] `terminal.resize` — 调整大小

**server — 终端事件：**
- [ ] `terminal.created` — 终端创建事件
- [ ] `terminal.output` — 输出流事件（Buffer + seq）
- [ ] `terminal.continuity_lost` — 连续性丢失
- [ ] `terminal.exited` — 进程退出

**server — 恢复机制：**
- [ ] Ring Buffer 序列号追踪
- [ ] HeadlessSnapshotBuffer 快照序列化
- [ ] `recovery.reconcile` 命令：根据 lastSeq 决定 replay / snapshot / closed / unrecoverable

**前端 — Terminal 组件：**
- [ ] xterm.js 集成（Terminal 组件 + fit addon + webgl addon）
- [ ] 二进制 WebSocket 收发
- [ ] 终端 Tab 管理（新建 / 关闭 / 切换）
- [ ] ResizeObserver → 自动 resize

**前端 — 断线重连：**
- [ ] 检测连接断开，自动重连（指数退避）
- [ ] 重连后发送 `recovery.reconcile`（携带 lastSeq）
- [ ] 接收 replay 数据，xterm 重放

**单元测试：**
- [ ] RingBuffer：写入/读取/FIFO 淘汰/序列号递增/空缓冲区读取
- [ ] HeadlessSnapshotBuffer：序列化/反序列化、空终端、满终端
- [ ] 二进制帧编解码：encode/decode 往返、各种 streamId、空 payload、大 payload、v2 嵌入 topic
- [ ] Input 双帧握手：正常流程、超时、payload 先于 JSON 到达（orphan 处理）
- [ ] 终端状态机：创建→活跃→关闭、重复关闭处理
- [ ] 终端色彩环境：环境变量设置、COLORFGBG 推导

**集成测试：**
- [ ] TerminalManager + RingBuffer：创建终端→写入数据→读取缓冲区→关闭
- [ ] TerminalManager + WS Hub：创建终端→发送 input→接收 output 事件
- [ ] 恢复流程：创建终端→写入数据→断开→重连→replay→验证输出一致

**E2E 测试：**
- [ ] 浏览器打开终端→执行 `echo hello`→看到输出
- [ ] 打开 3 个终端 tab→各自独立运行
- [ ] 断网重连→输出历史恢复

**验收：**
- 浏览器内终端可交互（包括 vim）
- 断线重连后输出恢复
- 多终端 tab 独立运行
- `bun run test` 全部通过

---

## Phase 2: WebSocket Hub + 连接管理（1 周）

**目标：** 完整的实时通信层，支撑所有后续功能。

### 任务

**server — WS Hub：**
- [ ] 连接管理（accept / disconnect / 连接数限制）
- [ ] Topic 订阅/取消（glob 匹配：`workspace.*.terminal.*`）
- [ ] JSON 命令消息处理（command → result RPC）
- [ ] 事件推送（topic + seq + timestamp + data）
- [ ] 订阅跟踪（每连接的订阅集合）

**server — 命令注册框架：**
- [ ] registerCommand(op, zodSchema, handler) 机制
- [ ] CommandContext 类型（注入 managers、repos、broadcasters）
- [ ] 错误标准化（ZodError → StructuredError）
- [ ] 命令超时处理

**server — 连接命令（1 个）：**
- [ ] `connection.probe` — 健康检查

**server — Activation 系统：**
- [ ] Lease-based 单活跃 tab
- [ ] Generation tracking（过期 lease 检测）
- [ ] 断开后 grace period（3s）
- [ ] Displacement 通知（WS close code 4001）
- [ ] `activation.claim` / `activation.release` 命令

**server — Fencing 系统：**
- [ ] Controller / Observer 模型
- [ ] Token + heartbeat（可见 10s / 隐藏 20s / 过期 30s）
- [ ] Force takeover
- [ ] `fencing.request` / `heartbeat` / `release` / `status` / `takeover` 命令

**前端 — WS 客户端：**
- [ ] 连接管理（自动重连 + 指数退避）
- [ ] Command dispatch（Promise-based，超时处理）
- [ ] Topic 订阅/取消
- [ ] 二进制终端传输
- [ ] Resync（lastSeen 序列号映射）

**前端 — Atom：**
- [ ] connectionAtom（status、error、serverInfo）
- [ ] dispatchCommandAtom
- [ ] activationAtom（status、generation）
- [ ] fencingAtom（isController、readOnly）

**单元测试：**
- [ ] Topic glob 匹配：`workspace.*.terminal.*` 匹配/不匹配各种路径
- [ ] 命令 dispatch：成功/失败/超时/未知命令
- [ ] Activation：claim/release/generation 过期/displacement
- [ ] Fencing：heartbeat/过期/takeover

**集成测试：**
- [ ] WS Hub + 命令注册：订阅 topic → 触发事件 → 收到推送
- [ ] 多连接 fencing：两个客户端连接，只有一个 controller
- [ ] Activation：claim → 另一个客户端 claim → displacement

**验收：**
- JSON 命令请求-响应正常
- Topic 订阅和事件推送正常
- 两个 tab 打开同一工作区，只有一个可输入（fencing）
- `bun run test` 全部通过

---

## Phase 3: 会话管理 + Provider（1.5 周）

**目标：** 可创建和管理 AI agent 会话。

### 任务

**core — Provider 接口：**
- [ ] ProviderDefinition 完整实现
- [ ] 能力描述：capability + capabilities 数组
- [ ] idleHeuristics 类型定义

**providers — 内置 Provider：**
- [ ] Claude Code provider
  - buildCommand：构建 claude CLI 启动命令
  - idleHeuristics：匹配 PTY 输出中的 prompt 模式
  - installStrategy：npm / brew
  - configSchema：apiKey 等配置项
- [ ] Codex provider
  - buildCommand + configSchema + idleHeuristics

**server — Session Manager：**
- [ ] create(providerId, workspaceId, config) → Session
- [ ] stop(sessionId)
- [ ] remove(sessionId)
- [ ] close(sessionId, paneDisposition)
- [ ] restart(sessionId)
- [ ] 状态机：draft → starting → running → idle → ended
  - starting：PTY 进程启动中
  - running：收到 agent 输出
  - idle：idleHeuristics 匹配
  - ended：进程退出
- [ ] 标题提取：从首条用户指令截取前 50 字符（超出加省略号）
- [ ] 输入活动追踪：记录输入类型（typing / submit / internal_submit / system / control）
- [ ] Session Repo：SQLite CRUD

**server — Session 命令（5 个）：**
- [ ] `session.list` — 列出工作区会话
- [ ] `session.create` — 创建会话（provider、config）
- [ ] `session.stop` — 停止会话
- [ ] `session.remove` — 删除已结束会话
- [ ] `session.close` — stop + delete + pane disposition

**server — Session Metadata：**
- [ ] objective、baseline git head
- [ ] `session.metadata.get` 命令

**server — 空闲检测：**
- [ ] 监听 PTY 输出，匹配 idleHeuristics 规则
- [ ] 匹配成功 → 更新状态为 idle
- [ ] 新输出到来 → 恢复为 running

**server — 会话事件：**
- [ ] `session.state.changed` — 状态转换（from/to）
- [ ] `session.lifecycle` — 生命周期（started/turn_completed/stopped/removed）

**前端 — 会话 UI：**
- [ ] 会话列表侧栏（按状态分组）
- [ ] 新建会话（provider 选择弹窗）
- [ ] 会话详情面板（状态指示器、重启/停止按钮）
- [ ] 会话 ↔ 终端关联

**前端 — Atom：**
- [ ] sessionsAtom（全量列表）
- [ ] sessionsByWorkspaceAtomFamily（按工作区分组）
- [ ] sessionByIdAtomFamily（按 ID 查询）
- [ ] activeSessionAtom（当前活跃会话）
- [ ] sessionCountByStateAtomFamily（状态统计）

**单元测试：**
- [ ] 会话状态机：所有合法转换 + 非法转换拒绝
- [ ] 标题提取：正常指令 / 超长指令（50 字符截断） / 空指令 / 多行指令
- [ ] 输入活动追踪：各输入类型的记录
- [ ] 空闲检测：匹配 / 不匹配 / 超时

**集成测试：**
- [ ] SessionManager + TerminalManager：创建会话 → PTY 启动 → 状态流转
- [ ] SessionManager + Provider：provider.buildCommand → 终端创建 → agent 运行
- [ ] 会话持久化：创建会话 → 重启服务 → 会话列表恢复

**E2E 测试：**
- [ ] 创建 Claude Code 会话 → 输入指令 → agent 响应 → 结束
- [ ] 并行运行 2 个会话
- [ ] 关闭浏览器再打开 → 会话列表恢复

**验收：**
- 创建会话后 agent 正常响应
- 状态正确流转
- 标题自动提取
- 并行多会话
- `bun run test` 全部通过

---

## Phase 4: 文件系统 + Git（2 周）

**目标：** 浏览器内浏览编辑文件、查看 git 状态和操作。

### 任务

**server — File Service：**
- [ ] readTree：递归目录扫描 + gitignore 过滤
- [ ] searchFiles：文件名搜索
- [ ] searchFileContents：全文搜索（匹配行 + 行号 + 列号 + 预览）
- [ ] readFile：文本/图片自动检测、baseHash
- [ ] writeFile：baseHash 冲突检测（乐观并发）
- [ ] createFile / createDirectory / deleteEntry / renameEntry
- [ ] resolveSafe：路径穿越防护

**server — File Watcher：**
- [ ] WorkspaceWatcher（chokidar）
- [ ] debounce 200ms，最大等待 1s
- [ ] .gitignore 过滤
- [ ] 文件变更事件 → `workspace.{id}.fs.dirty` topic 推送

**server — 文件命令（9 个）：**
- [ ] `file.readTree` / `file.search` / `file.searchContent`
- [ ] `file.read` / `file.create` / `file.mkdir`
- [ ] `file.delete` / `file.rename` / `file.write`

**server — Git Service：**
- [ ] getGitStatus：porcelain=v2 解析（branch、ahead/behind、staged、modified、untracked、deleted）
- [ ] getFileDiff：unified diff 生成（staged / unstaged）
- [ ] stageFiles / unstageFiles / discardChanges / commitChanges
- [ ] runGitPush / runGitPull / runGitFetch（含 HTTP auth，3 分钟网络超时）
- [ ] runGitCheckout / runGitCreateBranch / runGitListBranches
- [ ] getGitHistory / getGitCommitDiff
- [ ] GitAuthError：结构化认证失败（remote/host/reason）
- [ ] AutoFetchScheduler：viewer-based 后台 fetch（180s + jitter + 失败退避）

**server — Git 命令（14 个）：**
- [ ] `git.status` / `git.stage` / `git.diff` / `git.log` / `git.show`
- [ ] `git.unstage` / `git.discard` / `git.commit`
- [ ] `git.push` / `git.pull` / `git.fetch`
- [ ] `git.checkout` / `git.branch` / `git.branches`

**server — Git 事件：**
- [ ] `workspace.{id}.git.state` — git 状态变更

**前端 — 文件树组件：**
- [ ] 展开/折叠目录
- [ ] 右键菜单（新建/重命名/删除）
- [ ] 文件变更自动刷新
- [ ] 展开目录状态持久化

**前端 — Monaco 编辑器：**
- [ ] 打开文件到编辑器
- [ ] 保存（Ctrl+S，带 baseHash）
- [ ] 语言自动检测
- [ ] 图片文件预览

**前端 — 搜索面板：**
- [ ] 关键词输入 → 匹配结果列表
- [ ] 点击跳转到文件对应行

**前端 — Git 面板：**
- [ ] Status 文件列表（staged/modified/untracked 分组）
- [ ] 点击文件展示 diff
- [ ] Commit 输入框 + 提交按钮
- [ ] Branch 列表 + checkout
- [ ] Stage / unstage / discard 操作

**前端 — Atom：**
- [ ] fileTreeAtom
- [ ] gitStateAtom（status、branch、diff）
- [ ] searchResultsAtom

**单元测试：**
- [ ] Git status 解析：各种 porcelain=v2 输出格式
- [ ] 路径穿越检测：`../`、`~`、符号链接逃逸
- [ ] baseHash 冲突：匹配成功 / 不匹配
- [ ] gitignore 过滤：各种 pattern 匹配
- [ ] AutoFetchScheduler：定时触发 / 取消 / 失败退避

**集成测试：**
- [ ] FileService + Watcher：创建文件 → watcher 通知 → 文件树更新
- [ ] FileService + Git：修改文件 → git status 更新 → stage → commit
- [ ] Git push/pull：需要 mock remote 或使用本地 bare repo

**E2E 测试：**
- [ ] 文件树 → 打开文件 → 编辑 → 保存 → 终端 `cat` 验证
- [ ] Git status → stage → commit → log 验证
- [ ] 搜索 → 结果列表 → 点击跳转

**验收：**
- 文件树正确展示，gitignore 过滤生效
- 编辑保存后内容正确
- Git status/diff/commit 完整流程
- 搜索功能正常
- `bun run test` 全部通过

---

## Phase 5: 认证 + Settings + CLI + 响应式 UI（1.5 周）

**目标：** 安全访问、配置管理、一键启动、跨设备。

### 任务

**server — 认证系统：**
- [ ] Auth Plugin（Fastify plugin）
  - Cookie session（`cubby_auth` cookie）
  - 密码验证（bcrypt 哈希）
  - 路由守卫（非公开路径需认证）
  - 公开路径白名单
- [ ] Login Protection
  - IP 级暴力破解阻断（5 次失败锁定 15 分钟）
  - 失败记录持久化
- [ ] 认证路由：
  - GET `/auth/status`
  - POST `/auth/login`
  - POST `/auth/logout`
- [ ] 认证命令：
  - `auth.ban-list` / `auth.unblock`

**server — Settings 系统：**
- [ ] Settings Repo：SQLite key-value
- [ ] `settings.get` / `settings.update` 命令
- [ ] 嵌套 key 展平（`appearance.theme` → settings 表的 key）
- [ ] Config IO：读写 Claude/Codex 配置文件（含备份）
- [ ] `settings.previewCommand` 命令

**server — 健康检查：**
- [ ] GET `/healthz`

**server — 静态文件服务：**
- [ ] SPA fallback
- [ ] 静态资源缓存（1 year immutable）

**前端 — 认证 UI：**
- [ ] 登录页
- [ ] 未认证自动跳转
- [ ] authAtom（authenticated 状态）

**前端 — Settings UI：**
- [ ] 设置面板（provider/appearance/lsp/updates）
- [ ] 设置修改后实时生效

**前端 — 响应式 Shell：**
- [ ] 桌面 Shell：react-resizable-panels 多面板布局
  - 侧栏（文件树 / Git / 会话列表）
  - 编辑器区
  - 终端区
  - 面板大小持久化到 localStorage
- [ ] 移动 Shell：单面板 + 底部 tab（终端/编辑器/文件/Git）
- [ ] 900px 断点自动切换
- [ ] UI 组件库（30+ 组件）：
  button、input、modal、drawer、tabs、toast、tooltip、
  select、popover、spinner、status-dot、switch、badge、
  confirm-dialog、empty-state、progress-bar、sheet 等

**前端 — Topbar：**
- [ ] 导航栏（工作区名、会话状态、设置入口）

**cli — 完整命令：**
- [ ] `cubby open` — 启动服务 + 打开浏览器
- [ ] `cubby serve` — 后台启动（pid 文件 + detach）
- [ ] `cubby stop` — 读取 pid 文件，SIGTERM
- [ ] `cubby status` — 检查 pid + 进程存活
- [ ] `cubby logs` — 日志查看（tail、errors-only）
- [ ] `cubby config` — 配置管理（host、port、state-dir、password）
- [ ] `cubby auth ban-list` / `cubby auth unblock --ip`

**单元测试：**
- [ ] 认证：密码验证 / bcrypt / cookie 解析
- [ ] Login Protection：失败计数 / 锁定 / 解锁 / 过期
- [ ] Settings：get / update / 嵌套 key 展平
- [ ] CLI：命令解析 / pid 文件读写

**集成测试：**
- [ ] 认证流程：未登录 → 登录 → 访问 API → 登出
- [ ] Settings + WS：更新设置 → WS 推送变更
- [ ] CLI + Server：`cubby serve` → `cubby status` → `cubby stop`

**E2E 测试：**
- [ ] 未登录 → 跳转登录页 → 输入密码 → 进入工作区
- [ ] 桌面布局：面板拖拽 → 刷新 → 大小保持
- [ ] 移动布局：底部 tab 切换

**验收：**
- 密码认证完整流程
- 设置读写正常
- CLI 所有命令可用
- 桌面/移动布局正确切换
- `bun run test` 全部通过

---

## Phase 6: Workspace 管理 + Intelligence + 通知 + 日志（1 周）

**目标：** 完善工作区管理、智能检测、用户反馈。

### 任务

**server — Workspace Manager：**
- [ ] open(path)：路径验证 → 创建 Workspace → 启动 watcher → 水合
- [ ] close(workspaceId)：级联销毁（sessions → terminals → watcher）
- [ ] list()：列出已打开工作区
- [ ] browse(path)：浏览文件系统目录
- [ ] UI state 持久化（面板宽度、focus mode、pane layout、展开目录）
- [ ] 启动时水合 watcher

**server — Workspace 命令（6 个）：**
- [ ] `workspace.list` / `workspace.browse` / `workspace.open`
- [ ] `workspace.intelligence` / `workspace.close`
- [ ] `workspace.uiState.set`

**server — Workspace Activity：**
- [ ] `workspace.activate` / `workspace.deactivate`（注册 viewer for auto-fetch）
- [ ] `workspace.lastViewedTarget.get` / `set`

**server — Workspace Intelligence（已撤下）：**
- [ ] 不再作为近期核心路径；项目上下文由 README/AGENTS/CLAUDE 和 agent 终端自行处理。

**server — Diagnostics：**
- [ ] 诊断检查：workspace、git、node、providers、auth
- [ ] `diagnostics.get` / `diagnostics.recheck` 命令

**server — Toast 通知：**
- [ ] `notification.toast` topic 推送
- [ ] 通知设置（enabled / soundEnabled）

**server — 日志系统：**
- [ ] Fastify Pino 结构化日志
- [ ] 日志文件：`~/.cubby/logs/server.out.log` / `server.err.log`
- [ ] CLI 日志管理

**server — Provider 运行时状态：**
- [ ] `provider.runtimeStatus`：命令可用性、缺失依赖
- [ ] `provider.install.start` / `provider.install.get`：安装管理

**前端 — Workspace UI：**
- [ ] 工作区选择器（打开/切换/关闭）
- [ ] Welcome 页面
- [ ] Diagnostics 页面

**前端 — 通知 UI：**
- [ ] Toast 组件
- [ ] 通知设置

**单元测试：**
- [ ] Workspace Intelligence：已撤下，不再新增解析覆盖
- [ ] 级联销毁顺序验证
- [ ] Diagnostics：各检查项结果

**集成测试：**
- [ ] Workspace open → watcher 启动 → 文件变更 → 通知到达
- [ ] Workspace close → 所有关联资源清理

**E2E 测试：**
- [ ] 打开工作区 → 文件树展示 → 关闭工作区 → 清理
- [ ] Diagnostics 页面展示系统状态

**验收：**
- 工作区 open/close 完整流程
- Intelligence 正确检测项目类型
- 通知正常弹出
- `bun run test` 全部通过

---

## Phase 7: 集成测试 + E2E + 打包发布（1 周）

**目标：** 全面测试覆盖，打包发布就绪。

### 任务

**单元测试补充：**
- [ ] 所有边界情况覆盖
- [ ] 错误路径覆盖
- [ ] 测试覆盖率报告（目标：核心模块 > 80%）

**集成测试补充：**
- [ ] 跨模块流程：创建会话 → agent 执行 → 文件变更 → Git changes / File Explorer
- [ ] 错误恢复：终端崩溃 → 自动清理 → 可重新创建
- [ ] 并发场景：多终端同时写入、多会话并行

**E2E 测试：**
- [ ] 完整用户旅程：
  1. `cubby open` 启动
  2. 打开工作区
  3. 创建 agent 会话
  4. 输入指令，agent 执行
  5. 查看文件变更
  6. Git stage → commit
  7. 关闭会话
- [ ] 移动端旅程：
  1. 手机浏览器打开
  2. 底部 tab 切换
  3. 终端交互
  4. 文件浏览

**打包：**
- [ ] CLI 打包（bun build 或 esbuild）
- [ ] web 静态资源构建（vite build，含 monaco/xterm chunk 分离）
- [ ] server 启动脚本
- [ ] npm publish 配置：
  - 包名：`cubby-cli`
  - bin 字段：`cubby` → 编译后的 CLI 入口
  - files 字段：dist 目录 + web 构建产物
  - 版本管理：changesets（`@changesets/cli`）
- [ ] README 文档

**验收：**
- 所有单元测试通过
- 所有集成测试通过
- E2E 核心流程通过
- `bunx cubby-cli open` 从零启动成功
- 测试覆盖率报告生成

---

## 阶段依赖图

```
Phase 0 (骨架 + 数据模型)
  │
  ├── Phase 1 (终端系统) ──────┐
  │                             │
  ├── Phase 2 (WS Hub + 连接) ─┤
  │                             │
  └── Phase 3 (会话 + Provider)─┤
                                │
  Phase 4 (文件 + Git) ─────────┤
                                │
  Phase 5 (认证 + Settings +   │
           CLI + UI) ───────────┤
                                │
  Phase 6 (Workspace + Intel + │
           通知 + 日志) ────────┤
                                │
  Phase 7 (测试 + 打包) ────────┘
```

Phase 1、2、3 有部分并行空间（终端系统和 WS Hub 可同时开发）。
Phase 4 依赖 Phase 1（文件变更通知走 WS）。
Phase 5 依赖 Phase 1-4（UI 需要终端、编辑器、文件树都就绪）。
Phase 6 依赖 Phase 5（认证 + 设置是 workspace 管理的前提）。

---

## 测试分层策略

### 单元测试（Vitest，每个 Phase 同步写）

| 层 | 测什么 | 示例 |
|---|---|---|
| 数据结构 | RingBuffer、状态机、协议编解码 | 写入 10001 行，验证最旧行被淘汰 |
| 业务逻辑 | 标题提取、路径安全、git 解析 | `../../etc/passwd` 被拒绝 |
| 工具函数 | glob 匹配、key 展平、错误标准化 | `workspace.*.terminal.*` 匹配 |

### 集成测试（Vitest，模块间交互）

| 场景 | 涉及模块 |
|---|---|
| 创建终端 → 写入 → 读取 | TerminalManager + RingBuffer |
| 创建会话 → agent 启动 → 状态流转 | SessionManager + Provider + PTY |
| 文件修改 → watcher → 通知 | FileService + Watcher + WsHub |
| 认证 → API 调用 → 响应 | Auth + Route Handler |

### E2E 测试（Playwright，核心用户流程）

| 流程 | 步骤 |
|---|---|
| Agent 编码 | 打开工作区 → 创建会话 → 输入指令 → agent 响应 → 查看变更 |
| 文件编辑 | 文件树 → 打开 → 编辑 → 保存 → 验证 |
| Git 操作 | status → stage → commit → log |
| 认证 | 未登录 → 登录 → 使用 → 登出 |
| 移动端 | 切换 tab → 终端交互 → 文件浏览 |

---

## 关键技术决策

| 决策 | 选择 | 原因 |
|---|---|---|
| 运行时 | Bun | 原生 TS、bun:sqlite、bun-pty |
| PTY | bun-pty | Bun 原生兼容，Rust FFI |
| 持久化 | bun:sqlite | 替代 JSON 文件，支持事务和查询 |
| WS 消息 | 二进制(终端) + JSON(命令) | 终端需性能，命令需可调试 |
| UI 布局 | 单响应式 Shell | 减少维护负担 |
| 进程管理 | pid + detach | 替代 PM2 |
| 终端快照 | RingBuffer（replay）+ HeadlessSnapshotBuffer（完整状态） | 两种恢复策略互补 |
| 协议头 | 16 字节帧头（含 type/flags/streamId/payloadSize） | 支持多帧类型和 v2 嵌入 topic |
| 依赖版本 | 稳定版（TS 5.x、Vite 6.x） | 避免兼容坑 |
| 测试 | 边开发边写 | 不攒到最后 |
