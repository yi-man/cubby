# Cubby

Cubby 是一个自托管的个人 AI 编码工作台。你可以把它部署在自己的本机或 VPS 上，通过浏览器启动、监督、恢复和验收 AI agent 编码会话。

一句话定位：你自己的远程 AI 编码控制台，数据不上云，任何设备都能访问。

## 产品定位

Cubby 不是浏览器版 VS Code，也不是多人协作 IDE。代码写入、重构、测试命令和 Git 操作优先交给 agent session 在终端内完成；Cubby 本身优先提供远程访问安全、会话控制、终端连续性、运行预览、结果审阅、验证记录和环境诊断。

## 当前优先级

- 远程访问安全：认证、WebSocket 鉴权、Origin 约束、部署说明。
- CLI 服务管理：启动、停止、状态、日志和配置。
- 连接可靠性：WebSocket 自动重连、重新订阅、终端恢复。
- 端口预览：查看 agent 启动的 Vite、Next.js、API 或文档服务。
- Agent 工作流闭环：session review、verification runs、workspace intelligence、runtime diagnostics。

## 非目标

- 不把 Cubby 做成完整可编辑 IDE。
- 不优先做内置文件 CRUD UI。
- 不优先做多人协作、权限分级和多 Tab 强控制权。
- 不优先做完整 Git 写操作 UI；这些操作可以先由 agent 在终端内完成。

## 技术栈

- Bun
- Fastify
- React + Vite + TypeScript
- SQLite
- xterm.js
- Monaco Editor（只读文件查看和审阅为主）

## 开发命令

```bash
bun install
bun run dev
bun run build
bun run test
bun run test:e2e
bun run lint
```

## 运行时配置

默认运行时目录是用户级目录，不需要手动设置：

```text
~/.cubby/
  config.json
  cubby.db
```

正式服务默认监听 `0.0.0.0:6310`，方便同一网络内的其它设备访问。端口和 host 只有需要覆盖时才配置。

开发模式下，浏览器入口仍默认是 `6310`。后端 API/WebSocket 使用 dev 专用内部端口 `6300`，由 Vite 代理，不作为产品默认端口。需要覆盖 dev 端口时使用 `CUBBY_WEB_PORT` 和 `CUBBY_DEV_BACKEND_PORT`；正式服务端口仍使用 `CUBBY_PORT`。

首次正式启动时，如果 `~/.cubby/config.json` 不存在，Cubby 会自动创建默认配置。默认初始密码是 `cubby`，config 内只保存 bcrypt hash，不保存明文密码。

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 6310
  },
  "auth": {
    "passwordHash": "$2a$10$...",
    "allowedOrigins": ["https://cubby.example.com"]
  }
}
```

替换密码：

```bash
cubby auth set-password your-new-password
```

如果服务已经在运行，改完密码后重启 Cubby 生效。

启动服务：

```bash
bun packages/server/src/index.ts
```

环境变量只作为显式覆盖项：

- `CUBBY_HOST`
- `CUBBY_PORT`
- `CUBBY_AUTH_PASSWORD_HASH`
- `CUBBY_AUTH_PASSWORD`（仅建议临时开发使用）
- `CUBBY_AUTH_DISABLED`（仅建议测试或本机临时验证使用）
- `CUBBY_ALLOWED_ORIGINS`
- `CUBBY_DATA_DIR`（高级用法：测试、多实例、临时验证）

```bash
CUBBY_AUTH_PASSWORD_HASH='$2a$10$...' CUBBY_PORT=6400 bun packages/server/src/index.ts
```

登录 cookie 默认是 session cookie，不设置 `Max-Age` 或 `Expires`。

开发模式端口覆盖：

```bash
CUBBY_WEB_PORT=6410 CUBBY_DEV_BACKEND_PORT=6400 bun run dev
```

## 文档

- [PRD](docs/PRD.md)
- [Roadmap](docs/ROADMAP.md)
- [Plan](docs/PLAN.md)
