# Cubby — 项目规范

## 项目简介

Cubby 是一个自托管的个人 AI 编码工作台。用户在自己的服务器（本机或 VPS）上部署，通过浏览器访问，用它启动、监督、恢复和验收 AI agent 编码会话。

一句话定位：你自己的远程 AI 编码控制台，数据不上云，任何设备都能访问。

当前产品定位不是浏览器版 VS Code，也不是多人协作 IDE。写代码、改文件、跑命令和 Git 操作优先交给 agent session 在终端内完成；Cubby 本身优先提供远程访问安全、会话控制、终端连续性、应用预览、Git diff、文件查看和环境诊断。

技术栈：Bun + Fastify + React + SQLite。

## 产品原则

- Agent-first：用户主要通过自然语言和终端驱动 agent 完成开发，不把 Cubby 做成完整可编辑 IDE。
- 个人工作台：默认面向单人自托管使用，先保证个人远程工作流稳定，再考虑团队协作。
- 审阅优先于手改：文件浏览、diff 和 app preview 比内置文件写入更重要。
- 远程可用性优先：认证、服务管理、断线恢复、端口预览和诊断是远程开发的基础能力。
- 保守暴露能力：任何能触发终端、agent 或本机文件访问的入口都必须经过认证和路径安全约束。

## 目录结构

```
packages/
  core/        — 共享类型、协议定义、provider 接口、事件总线（无运行时依赖，仅 zod）
  server/      — Fastify 后端
  web/         — React 前端
  providers/   — Agent provider 定义
  cli/         — CLI 入口
e2e/           — Playwright E2E 测试
docs/          — PRD、PLAN
```

## 开发命令

```bash
bun install              # 安装依赖
bun run dev              # 启动开发（server + web 并行）
bun run build            # 构建所有包
bun run test             # 运行所有单元测试 + 集成测试
bun run test:e2e         # 运行 E2E 测试
bun run test:coverage    # 测试覆盖率报告
bun run lint             # Biome lint + format check
bun run lint:fix         # Biome 自动修复
```

正式服务默认监听 `0.0.0.0:6310`。`bun run dev` 的浏览器入口也默认是 `6310`，后端 API/WebSocket 走 dev 专用内部端口 `6300` 并由 Vite 代理；不要把 `CUBBY_PORT` 当作 dev 内部端口覆盖项，dev 端口使用 `CUBBY_WEB_PORT` / `CUBBY_DEV_BACKEND_PORT`。

正式 entrypoint 首次启动必须自动创建 `~/.cubby/config.json`，默认写入 server host/port、auth passwordHash 和 allowedOrigins。默认初始密码固定为 `cubby`，config 内只保存 bcrypt hash，不保存明文密码；改密码使用 `cubby auth set-password <password>`。登录 cookie 默认不设置 `Max-Age` / `Expires`。

## 代码规范

- TypeScript strict mode
- Biome 统一 lint 和 format，不使用 ESLint/Prettier
- 变量名、函数名 camelCase，类型 PascalCase，常量 UPPER_SNAKE_CASE
- 文件名 kebab-case
- 导入顺序：内置 → 第三方 → 内部（Biome 自动排序）
- 不用 default export，统一 named export
- 错误处理：不吞错误，不空 catch，使用 StructuredError（code / message / details）

## 测试规范（分层，边开发边写）

### 单元测试（Vitest，必须）
- 每个独立模块必须有单元测试
- 测什么：数据结构（RingBuffer）、状态机（Session）、协议编解码、业务逻辑（标题提取、路径安全、Git 解析）、工具函数
- 目标覆盖率：核心模块 > 80%
- 文件命名：`*.test.ts`，和源码同目录

### 集成测试（Vitest，必须）
- 模块间交互必须有集成测试
- 测什么：TerminalManager + RingBuffer、SessionManager + Provider + PTY、FileService + Watcher、Auth + Route Handler
- 可 mock 外部依赖（文件系统、Git remote），不 mock 内部模块

### E2E 测试（Playwright，Phase 7 集中写）
- 核心用户流程必须有 E2E 测试
- 流程：Agent 编码、会话恢复、结果审阅、端口预览、认证、移动端
- 本地验证必须优先跑真实 Claude CLI，不要用 mock provider 代替真实复现；只有 CI 或明确没有可用 `claude` 的环境才使用 `CUBBY_MOCK_CLAUDE_PROVIDER=1`

### 不测什么
- 第三方库内部逻辑（Monaco、xterm、Fastify 框架）
- 纯 UI 样式（通过视觉审查）

## Git 规范

- commit message：`type(scope): description`
  - type: feat / fix / refactor / test / docs / chore
  - scope: core / server / web / providers / cli
- 分支：main（稳定）+ feature 分支
- PR 合并前必须通过 lint + test

## 安全约束

- 密钥/token 不进代码、不进 commit、不进日志
- 文件操作限制在工作区目录内（路径穿越防护）
- 密码 bcrypt 哈希存储
- WebSocket 连接需认证（设置了密码时）

## 文档

- PRD：docs/PRD.md
- 开发计划：docs/PLAN.md
- 当前路线图：docs/ROADMAP.md
