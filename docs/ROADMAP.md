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

2. **CLI service management**
   - `cubby serve` 启动服务。
   - `cubby open` 打开本机浏览器。
   - `cubby stop` 停止后台服务。
   - `cubby status` 查看端口、PID、data dir、版本。
   - `cubby logs` 查看 server 日志。
   - `cubby config` 管理 host、port、data dir、auth。

3. **Reliable WebSocket reconnection**
   - 前端断线后指数退避重连。
   - 重连后恢复 session 列表和终端订阅。
   - 和现有 `recovery.reconcile` / replay / snapshot 串起来。
   - pending request 超时后给出明确 UI 状态。
   - 服务端 ping/pong keepalive。

4. **Port preview / app preview**
   - 检测工作区内正在监听的本机端口。
   - 展示端口列表、进程信息和最近活动。
   - 点击打开受认证保护的 preview URL。
   - 支持 HTTP / WebSocket 代理。
   - 支持复制链接和关闭端口记录。

### P1 — Agent 工作流闭环

5. **Session review**
   - 创建 session 时记录 baseline git HEAD。
   - 会话结束或手动触发时生成 changed files 列表。
   - 展示 baseline → current 的 diff 摘要。
   - 标记新增、修改、删除、重命名文件。
   - 展示 agent 最后一轮输出和退出状态。

6. **Verification runs**
   - 为 session 记录验证命令。
   - 支持手动运行测试、lint、build 等命令。
   - 保存命令、退出码、耗时、输出摘要和时间。
   - 在 session review 中展示验证结果。

7. **Workspace intelligence**
   - 检测 package manager。
   - 读取 package.json scripts / Makefile / README。
   - 识别常见框架和推荐 dev/test/build 命令。
   - 检查 AGENTS.md / CLAUDE.md / 项目文档。
   - 在新建 session 时提供上下文提示。

8. **Runtime diagnostics**
   - 检查 Claude Code / Codex / OpenCode 是否可用。
   - 检查 git、node、bun、常见 package manager。
   - 检查 data dir、端口、权限、磁盘空间。
   - 检查当前服务地址是否适合远程访问。
   - 给出明确修复建议。

### P2 — 审阅体验增强

9. **Read-only workspace review**
   - 全文搜索。
   - 快速打开文件。
   - Markdown 预览。
   - 图片预览。
   - 从 diff、验证失败和 session review 跳转到文件。

10. **Supervisor-lite**
    - 给 session 绑定 objective。
    - 检测长时间无输出或疑似卡住。
    - 手动触发 reviewer agent 检查当前结果。
    - 保存 review 建议，除非用户确认，否则不自动注入。

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
2. [#11 feat(cli): add serve/open/stop/status/logs/config commands](https://github.com/yi-man/cubby/issues/11)
3. [#12 feat(ws): add reconnect, resubscribe, and keepalive support](https://github.com/yi-man/cubby/issues/12)
4. [#13 feat(preview): add authenticated port preview proxy](https://github.com/yi-man/cubby/issues/13)
5. [#14 feat(session): add session review with baseline git diff](https://github.com/yi-man/cubby/issues/14)
6. [#15 feat(session): record verification runs](https://github.com/yi-man/cubby/issues/15)
7. [#16 feat(workspace): add project intelligence summary](https://github.com/yi-man/cubby/issues/16)
8. [#17 feat(diagnostics): add runtime diagnostics page](https://github.com/yi-man/cubby/issues/17)
9. [#18 feat(workspace): improve read-only file review](https://github.com/yi-man/cubby/issues/18)
10. [#19 feat(supervisor): add supervisor-lite review workflow](https://github.com/yi-man/cubby/issues/19)
