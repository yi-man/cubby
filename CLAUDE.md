# Cubby — 项目规范

## 项目简介

Cubby 是一个自托管的浏览器 AI 编码工作区。技术栈：Bun + Fastify + React + SQLite。

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
- 测什么：数据结构（RingBuffer）、状态机（Session/Supervisor）、协议编解码、业务逻辑（标题提取、路径安全、Git 解析）、工具函数
- 目标覆盖率：核心模块 > 80%
- 文件命名：`*.test.ts`，和源码同目录

### 集成测试（Vitest，必须）
- 模块间交互必须有集成测试
- 测什么：TerminalManager + RingBuffer、SessionManager + Provider + PTY、FileService + Watcher、Auth + Route Handler
- 可 mock 外部依赖（文件系统、Git remote），不 mock 内部模块

### E2E 测试（Playwright，Phase 7 集中写）
- 核心用户流程必须有 E2E 测试
- 流程：Agent 编码、文件编辑、Git 操作、认证、移动端
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
