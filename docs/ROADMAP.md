# Cubby — Roadmap

## 当前定位

Cubby 是一个自托管的个人 AI 编码工作台。它不是浏览器版 VS Code，也不是多人协作 IDE。用户主要通过 agent session 完成写代码、改文件、跑命令和 Git 操作；Cubby 负责提供安全远程访问、会话控制、终端连续性、应用预览、结果审阅、验证记录和环境诊断。

## 近期优先级

### P0 — 远程可用基础

1. **Authenticated remote access** — ✅ Done ([#10](https://github.com/yi-man/cubby/issues/10))
   - 密码登录或本地配置 token。
   - Cookie session。
   - WebSocket 鉴权。
   - Origin 白名单。
   - 登录限速和失败锁定。
   - 反代 / HTTPS 部署说明。

2. **CLI service management** — ✅ Done ([#11](https://github.com/yi-man/cubby/issues/11))
   - `cubby serve` 启动服务。
   - `cubby open` 打开本机浏览器。
   - `cubby stop` 停止后台服务。
   - `cubby status` 查看端口、PID、data dir、版本。
   - `cubby logs` 查看 server 日志。
   - `cubby config` 管理 host、port、data dir、auth。

3. **Reliable WebSocket reconnection** — ✅ Done ([#12](https://github.com/yi-man/cubby/issues/12))
   - 前端断线后指数退避重连。
   - 重连后恢复 session 列表和终端订阅。
   - 和现有 `recovery.reconcile` / replay / snapshot 串起来。
   - pending request 超时后给出明确 UI 状态。
   - 服务端 ping/pong keepalive。

4. **Port preview / app preview** — ✅ Done ([#13](https://github.com/yi-man/cubby/issues/13))
   - 检测工作区内正在监听的本机端口。
   - 展示端口列表、进程信息和最近活动。
   - 点击打开受认证保护的 preview URL。
   - 支持 HTTP / WebSocket 代理。
   - 支持复制链接和关闭端口记录。

### P1 — Agent 工作流闭环

5. **Workspace / Review / Verification surfaces** — Removed
   - Workspace intelligence UI/API 已撤下，避免和 README/项目说明重复。
   - Session review UI/API 已撤下，改由 Git Changes 和 File Explorer 承担验收入口。
   - Verification runs UI/API 已撤下，验证命令继续由 agent 在终端内执行。
   - Supervisor-lite UI/API 已撤下。

8. **Runtime diagnostics** — ✅ Done ([#17](https://github.com/yi-man/cubby/issues/17))
   - 检查 Claude Code / Codex / OpenCode 是否可用。
   - 检查 git、node、bun、常见 package manager。
   - 检查 data dir、端口、权限、磁盘空间。
   - 检查当前服务地址是否适合远程访问。
   - 给出明确修复建议。

### P2 — 审阅体验增强

9. **Read-only workspace review** — ✅ Done ([#18](https://github.com/yi-man/cubby/issues/18))
   - 全文搜索。
   - 快速打开文件。
   - Markdown 预览。
   - 图片预览。
   - 从 Git diff 跳转到文件。

10. **Supervisor-lite** — Removed ([#19](https://github.com/yi-man/cubby/issues/19))
    - 该入口价值不足，已从工具栏和 HTTP API 中撤下。

## 降低优先级

- 内置可编辑文件编辑器。
- 文件 CRUD UI。
- 多 Tab 强控制权 / fencing。
- 完整 LSP IDE 体验。
- 完整 Git 写操作 UI。
- 多用户团队协作和权限分级。

## GitHub Issues

这些条目已经同步为 GitHub issues：

1. ✅ [#10 feat(auth): add password login and websocket authentication](https://github.com/yi-man/cubby/issues/10)
2. ✅ [#11 feat(cli): add serve/open/stop/status/logs/config commands](https://github.com/yi-man/cubby/issues/11)
3. ✅ [#12 feat(ws): add reconnect, resubscribe, and keepalive support](https://github.com/yi-man/cubby/issues/12)
4. ✅ [#13 feat(preview): add authenticated port preview proxy](https://github.com/yi-man/cubby/issues/13)
5. ✅ [#14 feat(session): add session review with baseline git diff](https://github.com/yi-man/cubby/issues/14)
6. ✅ [#15 feat(session): record verification runs](https://github.com/yi-man/cubby/issues/15)
7. ✅ [#16 feat(workspace): add project intelligence summary](https://github.com/yi-man/cubby/issues/16)
8. ✅ [#17 feat(diagnostics): add runtime diagnostics page](https://github.com/yi-man/cubby/issues/17)
9. ✅ [#18 feat(workspace): improve read-only file review](https://github.com/yi-man/cubby/issues/18)
10. Removed: [#19 feat(supervisor): add supervisor-lite review workflow](https://github.com/yi-man/cubby/issues/19)
