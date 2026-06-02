# Cubby — 产品需求文档

## 产品定义

**Cubby** 是一个自托管的浏览器 AI 编码工作区。用户在自己的服务器（本机或 VPS）上部署，通过浏览器访问，获得完整的 AI agent 编码体验。

**一句话定位：** 你自己的浏览器编码工作区，数据不上云，任何设备都能访问。

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 + 包管理 | Bun |
| PTY | bun-pty |
| 数据库 | bun:sqlite |
| 后端 | Fastify 5 |
| 前端 | React 19 + Vite + TypeScript |
| 状态管理 | Jotai 2 |
| 终端 | xterm.js 6 |
| 编辑器 | Monaco Editor |
| 通信 | WebSocket（二进制终端 + JSON 命令） |
| 认证 | Cookie session + bcrypt |
| 测试 | Vitest（单元/集成）+ Playwright（E2E） |
| Lint | Biome |

## Monorepo 结构

```
cubby/
  packages/
    core/        — 共享类型、协议定义、provider 接口、事件总线
    server/      — Fastify 后端
    web/         — React 前端
    providers/   — Agent provider 定义
    cli/         — CLI 入口
  e2e/           — E2E 测试
  docs/          — 文档
```

> **与 coder-studio 的结构差异：** 不含 `packages/utils`（Bun 原生无需 Windows shim resolver）和 `packages/hook-bridge`（hook 系统作为 P2 功能后续引入）。

---

## 功能清单

### P0 — 核心功能（MVP）

#### F1: Workspace 管理
- 打开工作区（指定路径，验证路径存在可读）
- 关闭工作区（级联销毁：sessions → terminals → LSP → supervisor → watcher）
- 列出已打开的工作区
- 浏览文件系统选择路径（`workspace.browse`）
- UI 状态持久化（面板宽度、focus mode、pane layout、展开目录列表）
- 启动时恢复 watcher

**验收标准：**
- [ ] 输入路径打开工作区，文件树正确展示
- [ ] 关闭工作区后所有关联终端、会话被清理
- [ ] 刷新页面后面板宽度、展开目录保持
- [ ] 路径不存在或无权限时给出明确错误

#### F2: PTY 终端系统
- 服务端 bun-pty 创建真实 PTY 进程
- 前端 xterm.js 渲染（fit addon + webgl addon）
- 二进制 WebSocket 协议：16 字节帧头（version, type, flags, meta, streamId, payloadSize）+ payload
  - 帧类型：Output(1)、Replay(2)、Input(3)、Snapshot(4)
  - Output 帧使用 v2 格式，嵌入 topic string 和序列号
  - Input 帧使用 JSON 命令 + 二进制 payload 双帧握手（5 秒超时）
- 环形缓冲区存储输出历史（容量 10000 行），支持序列号追踪
- HeadlessSnapshotBuffer：无头 xterm.js 实例序列化完整终端状态（光标位置、样式等），用于 `terminal.snapshot` 命令
- 断线重连：根据 lastSeq 决定 replay / snapshot / closed / unrecoverable
- 终端 resize（cols/rows 同步，相同值跳过 syscall 避免多余 SIGWINCH）
- 多终端 tab 并存
- 终端关闭和进程退出事件（退出后延迟 1 秒清理资源）
- 活动终端追踪（per session）
- 终端色彩环境：强制设置 `TERM=xterm-256color`、`COLORTERM=truecolor`、`FORCE_COLOR=3`；从主题背景色推导 `COLORFGBG` 供 TUI 程序配色

**验收标准：**
- [ ] 浏览器内打开终端，执行命令有实时输出
- [ ] 执行 `vim` 等全屏程序可正常交互
- [ ] 断网后重连，输出历史恢复
- [ ] 同时打开 3 个终端 tab，各自独立
- [ ] 拖拽面板后终端自动 resize，输出不截断
- [ ] 终端进程退出后 UI 显示退出状态

#### F3: Agent 会话管理
- 会话生命周期状态机：draft → starting → running → idle → ended
- 会话标题从首条用户指令自动提取（截取前 50 字符，超出部分加省略号）
- 输入活动追踪：记录输入类型（typing / submit / internal_submit / system / control），用于 supervisor 触发判断
- 会话元数据持久化到 SQLite
- 支持并行多会话，不同 provider 并存
- 会话列表展示（按状态分组）
- 会话操作：创建、停止、删除、关闭（stop + delete + pane disposition）、重启
- 会话元数据：objective、baseline git head、verification runs

**验收标准：**
- [ ] 创建会话后 agent 正常响应
- [ ] 状态正确流转：starting → running → idle → ended
- [ ] 标题自动提取
- [ ] 并行运行 2 个不同 provider 的会话
- [ ] 刷新页面后会话列表恢复
- [ ] 重启会话保留旧配置

#### F4: Provider 抽象层
- 声明式 ProviderDefinition 接口：
  - id、displayName、badge、kind（built_in/preset/custom）
  - capability（full/limited/unsupported）+ capabilities 数组
  - buildCommand(options) → argv/env/cwd
  - buildSupervisorEvalCommand()（P1 用）
  - configSchema（Zod）
  - idleHeuristics（PTY 输出匹配规则）
  - installStrategy（brew/npm/winget）
- 内置 provider：Claude Code、Codex
- Custom Provider CRUD（创建/读取/更新/删除）
- Provider 运行时状态检测（命令可用性、缺失依赖）
- Provider 安装管理（自动安装 + 进度追踪）
- 设置中预览 provider CLI 命令（`settings.previewCommand`）

**验收标准：**
- [ ] Claude Code / Codex provider 可正常启动会话
- [ ] 自定义 provider 创建后 UI 列表出现
- [ ] CLI 未安装时给出明确错误
- [ ] 空闲检测：agent 停顿超时后状态变 idle
- [ ] provider 安装过程有进度展示

#### F5: WebSocket Hub（实时通信层）
- Topic 发布/订阅（层级命名 + glob 匹配）
- 二进制终端消息（16 字节帧头 + payload）
- JSON 命令消息（RPC：command → result，event 推送）
- 订阅/取消订阅
- 断线重连 + resync（lastSeen 序列号映射）
- Keepalive ping/pong（15 秒间隔）
- 完整 Topic 体系：
  - `connection.status` / `connection.ready`
  - `workspace.{id}.meta` / `workspace.{id}.fs.dirty` / `workspace.{id}.git.state`
  - `workspace.{id}.session.{sid}.state` / `...lifecycle` / `...progress`
  - `workspace.{id}.terminal.{tid}.output` / `...created` / `...exit` / `...continuity_lost`
  - `workspace.{id}.lsp.diagnostics`
  - `workspace.{id}.session.{sid}.supervisor.state`
  - `notification.toast`
  - `update.state.changed`
- 完整命令体系（105 个 WS 命令，见下方清单）

**验收标准：**
- [ ] 终端输出通过二进制 WS 实时到达前端
- [ ] JSON 命令请求-响应正常
- [ ] 断线重连后补发丢失消息
- [ ] topic glob 订阅正确匹配

#### F6: 文件系统操作
- 文件树浏览（递归目录 + gitignore 过滤）
- 文件 CRUD：read / write / create / mkdir / delete / rename
- 文件写入 baseHash 冲突检测（乐观并发控制）
- 文件内容搜索（关键词 + 匹配行 + 行号）
- 文件名搜索
- chokidar 文件监听（debounce 200ms + .gitignore 过滤）
- 图片文件检测和流式服务
- 路径穿越防护（`resolveSafe`）

**验收标准：**
- [ ] 文件树正确展示，node_modules 被过滤
- [ ] 编辑保存后终端 `cat` 验证内容正确
- [ ] 搜索返回匹配结果
- [ ] 终端 `touch` 新文件后文件树自动更新
- [ ] 删除文件需二次确认
- [ ] 写入冲突（baseHash 不匹配）时返回错误
- [ ] 路径穿越尝试被拒绝

#### F7: Git 集成
- git status 解析（porcelain=v2：staged/modified/untracked/deleted + ahead/behind）
- diff 生成（staged / unstaged）
- stage / unstage / discard
- commit 创建
- branch 列表（local + remote）/ create / checkout
- git log（提交历史）
- git show（commit diff by SHA）
- git push / pull / fetch（含 HTTP auth 支持，网络操作 3 分钟超时）
- 结构化 GitAuthError（remote/host/reason）
- 后台定时 auto-fetch（viewer-based，180s 周期 + jitter + 失败退避）

**验收标准：**
- [ ] 修改文件后 git status 实时更新
- [ ] stage → commit 流程完整
- [ ] diff 正确展示
- [ ] branch 切换正常
- [ ] push/pull/fetch 可执行（需 remote 配置）
- [ ] HTTP auth 失败时给出结构化错误

#### F8: Settings 系统
- 完整设置项：
  - 默认 provider
  - 通知（enabled / soundEnabled）
  - Supervisor（评估超时、重试设置）
  - 外观（theme、terminal renderer、locale、font sizes、personalization）
  - LSP mode（auto/off）
  - Updates（auto-check、interval）
  - Provider configs（per-provider key-value）
  - Git（autofetchPeriodSec 后台 fetch 间隔）
- 设置读取 / 更新（支持嵌套 key 展平）
- Config IO：读写 Claude/Codex 配置文件（含备份）

**验收标准：**
- [ ] `settings.get` 返回所有设置项
- [ ] `settings.update` 修改后持久化
- [ ] 刷新页面后设置保持
- [ ] 配置文件读写正常

#### F9: 响应式 UI
- 单套响应式 Shell（非双 Shell）
- 桌面（≥ 900px）：多面板布局（react-resizable-panels），可拖拽
- 移动（< 900px）：单面板 + 底部 tab（终端/编辑器/文件/Git）
- 共享 atom + hook，布局通过 CSS container query + 条件渲染切换
- UI 组件库（30+ 组件）：button、input、modal、drawer、tabs、toast、tooltip、select、popover 等

**验收标准：**
- [ ] 桌面浏览器显示多面板布局
- [ ] 移动浏览器显示单面板 + 底部 tab
- [ ] 面板可拖拽调整大小
- [ ] 同一 URL 两种设备都能正常使用

#### F10: 认证系统
- 可选密码认证（bcrypt 哈希）
- Cookie session（`cubby_auth` cookie）
- IP 暴力破解阻断（5 次失败锁定 15 分钟）
- 所有 HTTP + WS 路由守卫（设置了密码时）
- 公开路径：`/`、`/login`、`/healthz`、`/auth/*`、静态资源
- CLI 管理：`cubby auth ban-list`、`cubby auth unblock --ip <ip>`

**验收标准：**
- [ ] 设置密码后访问被拦截
- [ ] 正确密码登录成功
- [ ] 5 次错误后 IP 被锁
- [ ] 未设置密码时直接进入

#### F11: CLI 工具
- 命令：open / serve / stop / status / logs / config / auth
- 后台服务管理（pid 文件 + detach，不用 PM2）
  > **决策说明：** coder-studio 使用 PM2 管理后台进程（有自动重启能力）。Cubby 改用 pid+detach 减少外部依赖，代价是失去进程崩溃自动恢复。如需自动恢复，可在 CLI 层加 watchdog 逻辑。
- 配置项：port、host、dataDir、password
- 日志管理：tail、errors-only
- 版本号：`cubby --version`

**验收标准：**
- [ ] `cubby open` 启动 + 打开浏览器
- [ ] `cubby stop` 停止服务
- [ ] `cubby status` 显示运行状态
- [ ] 端口被占用时给出错误

---

### P1 — 扩展功能

#### F12: Supervisor 系统
- 评估→注入循环（evaluate → inject guidance）
- 状态机：inactive → idle → evaluating → injecting → paused → error → stopped
- 工作项分解（stage 模式 + subtarget 模式）
- 评估器：独立 CLI 进程执行，JSON 输出解析
- 注入器：通过 bracketed paste 写入 agent 终端
- 上下文构建：终端快照 + 会话状态 + 目标记忆（含分解追踪、停滞计数）
- 调度器：
  - 自动触发：监听 session.lifecycle turn_completed 事件
  - 手动触发：`supervisor.trigger` 命令
  - 定时触发：设定未来时间自动执行评估
- 目标存储：`.cubby/supervisor/targets/`（meta.json、memory.json、cycles.jsonl）
- 可配置：评估超时（默认 600s，最大 86400s）、重试次数/延迟、超时重试、错误重试、最大监管次数
- 目标恢复：从历史目标恢复（`supervisor.restore`）
- UI：创建、监控、暂停/恢复、手动触发

**验收标准：**
- [ ] 启用 supervisor 后 agent 偏离目标时自动注入
- [ ] 状态实时展示
- [ ] 可暂停/恢复
- [ ] 评估历史可查看

#### F13: LSP 集成
- 服务端 LSP Manager（per-workspace，idle timeout 60s，restart limit）
- 语言检测：TypeScript、Python、Go、Rust
- 文档生命周期：open / change / close
- 功能：definition、declaration、typeDefinition、references、hover、documentSymbols
- 诊断广播（通过 `workspace.{id}.lsp.diagnostics` topic）
- LSP 工具管理：可用性检测、来源检测（override/managed/bundled/system）
- LSP 安装管理：自动安装 + 进度

**验收标准：**
- [ ] 编辑 .ts 文件时 Monaco 显示错误波浪线
- [ ] go-to-definition 跳转正确
- [ ] hover 展示类型信息
- [ ] 诊断实时更新

#### F14: Workspace Intelligence
- 检测 package manager（npm/pnpm/yarn/bun）
- 检测框架
- 提取 package.json scripts
- 检测 Makefile commands
- 查找文档（README、docs/）
- 检查 AGENTS.md
- UI 展示推荐命令，可一键执行

**验收标准：**
- [ ] Next.js 项目自动识别出 dev 命令
- [ ] 推荐命令可执行

#### F15: Session Review
- 会话结束后生成 review summary
- 变更文件列表（baseline HEAD → current HEAD diff）
- 验证运行结果
- 警告（missing baseline、not git repo）
- 文件级 diff 查看

**验收标准：**
- [ ] 会话结束后可查看变更文件列表
- [ ] 点击文件可查看 diff

#### F16: Agent Context & Instructions
- 上下文包构建：fromFile / fromDiff / fromProjectSummary / fromSessionReview
- Agent 指令生成：从 workspace intelligence 自动生成 `.cubby/AGENTS.md`
- 指令健康度评估

**验收标准：**
- [ ] 从文件构建上下文包
- [ ] 自动生成 AGENTS.md
- [ ] 健康度评估给出建议

#### F17: Upload 系统
- 文件上传（multipart）
- 剪贴板截图上传
- Bucket 存储（per workspace per day）
- 上传清理：启动 GC、workspace 关闭级联清理、bucket 容量限制

**验收标准：**
- [ ] 上传图片到工作区
- [ ] 上传文件在工作区内可访问
- [ ] 关闭工作区后上传文件被清理

#### F18: Preview 系统
- Markdown 渲染预览（服务端 markdown → HTML）
- HTML 预览
- 资源加载（从工作区加载图片、CSS）
- 预览 session 管理（revision tracking）

**验收标准：**
- [ ] 打开 .md 文件可预览渲染结果
- [ ] 预览中图片正确加载

#### F19: Fencing & Activation（多 Tab 并发控制）
- Activation：单活跃 tab 强制（lease-based，generation tracking）
- Fencing：controller/observer 模型（token + heartbeat）
- 心跳：可见 tab 10s，隐藏 20s，过期 30s
- Force takeover（controller 无响应时）
- Displacement 通知（WS close code 4001）

**验收标准：**
- [ ] 两个 tab 打开同一工作区，只有一个可输入
- [ ] 活跃 tab 关闭后另一个自动接管
- [ ] 只读 tab 显示只读指示

#### F20: 诊断系统
- 运行诊断检查：workspace、git、node、providers、auth、mobile host
- 重新检查
- UI 展示诊断结果

**验收标准：**
- [ ] 诊断页面展示系统状态
- [ ] 缺失依赖时给出安装建议

#### F21: Toast 通知
- 客户端 toast 通知系统
- 通过 `notification.toast` topic 推送
- 通知设置（enabled / soundEnabled）

**验收标准：**
- [ ] 操作成功/失败时弹出 toast
- [ ] 通知可关闭

#### F22: 日志系统
- Fastify Pino 结构化日志
- 日志文件：`~/.cubby/logs/server.out.log`、`server.err.log`
- CLI 日志管理：`cubby logs --tail`、`--errors-only`
- Supervisor evaluator debug 日志

**验收标准：**
- [ ] `cubby logs` 可查看服务日志
- [ ] 错误日志有结构化信息

---

### P2 — 锦上添花

#### F23: 更新系统
- 版本检查（定期 + 手动）
- 后台安装（activity-aware：等待终端/会话空闲）
- 安装状态广播

#### F24: Command Palette
- Ctrl+K 快捷命令面板
- 搜索命令/文件/工作区

#### F25: Quick Open
- 快速打开文件（Ctrl+P）
- 快速切换工作区

#### F26: Focus Mode
- 无干扰模式（隐藏侧栏，只留编辑器/终端）

#### F27: i18n
- 中英文切换

#### F28: Appearance 个性化
- 背景图上传/管理
- 毛玻璃效果、暗度、透明度
- 桌面/移动端独立覆盖

#### F29: 多语言 LSP
- TypeScript / Python / Go / Rust

#### F30: Git Image Revision
- 读取指定 git revision 的图片文件

#### F31: Git Worktree
- worktree CRUD + status / diff / tree

---

## WS 命令完整清单

共 105 个命令，按模块分组：

| 模块 | 命令数 | 命令列表 |
|---|---|---|
| activation | 2 | claim, release |
| connection | 1 | probe |
| recovery | 1 | reconcile |
| session | 5 | list, create, stop, remove, close |
| session-metadata | 2 | get, verification.add |
| session-review | 2 | summary, diff |
| terminal | 7 | list, create, replay, snapshot, close, input, resize |
| file | 9 | readTree, search, searchContent, read, create, mkdir, delete, rename, write |
| git | 14 | status, stage, diff, log, show, unstage, discard, commit, push, pull, fetch, checkout, branch, branches |
| workspace | 6 | list, browse, open, intelligence, close, uiState.set |
| workspace-activity | 4 | activate, deactivate, lastViewedTarget.get, lastViewedTarget.set |
| settings | 5 | get, update, previewCommand, readConfigFile, writeConfigFile |
| diagnostics | 2 | get, recheck |
| provider | 4 | list, runtimeStatus, install.start, install.get |
| custom-provider | 4 | list, create, update, delete |
| supervisor | 9 | create, get, listRecoverableTargets, update, delete, pause, resume, trigger, restore |
| worktree | 6 | list, status, diff, tree, create, remove |
| fencing | 5 | request, heartbeat, release, status, takeover |
| lsp | 14 | ensureSession, setMode, runtimeStatus, install.start, install.get, openDocument, changeDocument, closeDocument, definition, declaration, typeDefinition, references, hover, documentSymbols |
| updates | 4 | getState, check, prepareInstall, startInstall |
| agent-context | 4 | fromFile, fromDiff, fromProjectSummary, fromSessionReview |
| agent-instructions | 4 | read, generate, write, health |

---

## HTTP 路由清单

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/auth/status` | 认证状态 |
| POST | `/auth/login` | 登录 |
| POST | `/auth/logout` | 登出 |
| GET | `/healthz` | 健康检查 |
| GET | `/api/file` | 图片文件流式服务（含 git revision） |
| POST | `/api/uploads` | 文件上传 |
| POST/GET/PUT/DELETE | `/api/preview/session` | 预览 session CRUD |
| GET | `/api/preview/session/:id/*` | 预览渲染 |
| POST/GET/DELETE | `/api/appearance-assets` | 外观资源管理 |
| GET | `/ws` | WebSocket 端点 |
| GET | `/*` | SPA fallback |

---

## 非功能需求

### 性能
- 终端输出延迟 < 100ms（本地部署）
- 文件树加载 < 500ms（1000 文件规模）
- WebSocket 重连 < 3 秒（指数退避：1s 基础，30s 上限）
- 环形缓冲区容量：10000 行
- WS 二进制消息超时：5 秒
- Git 网络操作超时：3 分钟
- WS keepalive：15 秒 ping 间隔

### 安全
- 密码 bcrypt 哈希存储
- 路径穿越防护（`resolveSafe` / `isPathInsideRoot`）
- Cookie session 认证
- IP 暴力破解阻断

### 存储
- **决策：** 使用 bun:sqlite 替代 coder-studio 的 JSON 文件存储
- **原因：** Bun 原生支持 SQLite，提供事务、查询能力和更好的并发性能
- **迁移策略：** 新项目无需迁移，直接建表

### 进程管理
- **决策：** 使用 pid+detach 替代 PM2
- **原因：** 减少外部依赖，Bun 原生支持 daemonize
- **代价：** 失去 PM2 的进程崩溃自动恢复，需在 CLI 层自行实现 watchdog

### 兼容性
- 浏览器：Chrome 90+、Firefox 90+、Safari 15+
- 操作系统：Linux、macOS
- Bun 1.1+
