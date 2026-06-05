# Cubby — 架构与主流程

本文档描述 Cubby 当前实现的主流程，分三个层面：整体架构、会话生命周期状态机、终端历史回放。

Cubby 是一个浏览器端的自托管 AI 编码工作区。前端 React 通过 WebSocket（命令式 RPC）与 Fastify 后端通信，后端通过 Provider 拉起 `claude` CLI 的 PTY 进程，并把终端输出实时广播回前端。

## 1. 整体架构

```mermaid
flowchart LR
    subgraph Browser["浏览器 (packages/web)"]
        UI["App / SessionView"]
        WS_Hook["useWebSocket\n(send / request / onMessage)"]
        Term["TerminalView (xterm)"]
        UI --> WS_Hook
        Term <--> UI
    end

    subgraph Server["Fastify 后端 (packages/server)"]
        WSRoute["/ws WebSocket 入口"]
        Handler["WSCommandHandler\n命令分发"]
        Hub["WebSocketHub\n订阅 / 广播"]
        SM["SessionManager\n状态机 + 进程管理"]
        Store["SessionStore (SQLite)"]
        Ring["RingBuffer\n输出缓存"]
        Provider["ClaudeCodeProvider"]
    end

    subgraph External["外部进程"]
        PTY["bun-pty"]
        CLI["claude CLI"]
    end

    WS_Hook <-->|"JSON 命令/响应"| WSRoute
    WSRoute --> Handler
    Handler --> SM
    Handler --> Hub
    SM --> Store
    SM --> Ring
    SM --> Provider
    Provider --> PTY --> CLI
    CLI -->|stdout| PTY -->|onData| Provider
    Provider -->|onOutput| SM
    SM -->|"terminal.output 广播"| Hub
    Hub -->|"推送给订阅者"| WS_Hook
```

## 2. 会话生命周期（主用户流程时序）

从「选目录建会话」到「启动 → 交互 → 停止 → 恢复」的完整链路：

```mermaid
sequenceDiagram
    participant U as 用户
    participant Web as Web (App/SessionView)
    participant H as WSCommandHandler
    participant SM as SessionManager
    participant P as ClaudeCodeProvider
    participant Hub as WebSocketHub

    U->>Web: 选择工作目录 (DirPicker)
    Web->>H: session.create {workspaceId, provider}
    H->>SM: createSession()
    SM-->>Web: Session(status=draft)

    Note over Web: autoStart 触发
    Web->>H: session.start {sessionId, cwd, cols, rows}
    H->>SM: startSession()
    SM->>SM: status=starting (广播 session.status)
    SM->>P: spawn(claude, args)
    P-->>SM: AgentProcess(pid)
    SM->>SM: status=running (广播)

    Web->>H: terminal.subscribe
    H->>Hub: subscribe(ws, terminal:id)

    loop 交互
        U->>Web: 键入
        Web->>H: terminal.input {data}
        H->>P: process.write(data)
        Note over SM: recordTerminalInput → 首条输入生成标题
        P-->>SM: onOutput(stdout)
        SM->>Hub: broadcast terminal.output
        Hub-->>Web: 实时输出 → xterm 渲染
    end

    alt 用户停止
        U->>Web: Stop
        Web->>H: session.kill
        H->>SM: killSession() → status=ended
    else 进程退出
        P-->>SM: onExit(code) → status=ended
    end

    Note over U,Hub: 之后可 Resume
    U->>Web: Resume
    Web->>H: session.resume (--resume sessionId)
    SM->>P: spawn(resume=true)
```

### 状态机

`SESSION_STATUS = draft → starting → running → idle → ended`，状态变更通过 `SessionManager.onStatusChange` 监听器全量广播（`session.status` 事件）。

```mermaid
stateDiagram-v2
    [*] --> draft: session.create
    draft --> starting: session.start
    starting --> running: spawn 成功
    starting --> ended: spawn 失败
    running --> ended: session.kill / 进程退出
    ended --> starting: session.resume
    ended --> [*]
```

## 3. 终端历史与回放（Replay）

非存活会话（`ended`）打开时，前端请求历史回放；存活会话（`running`/`starting`）则直接订阅实时流。

```mermaid
flowchart TD
    Open["SessionView 打开会话"] --> Check{"status 是否存活?\n(starting/running)"}

    Check -->|是| Sub["terminal.subscribe\n直接接收实时输出"]
    Check -->|否| Replay["terminal.replay 请求"]

    Replay --> Hist["SessionManager.getOutputHistory"]
    Hist --> S1{"SQLite 持久化历史?"}
    S1 -->|有| Out["返回 chunks"]
    S1 -->|无| S2{"RingBuffer 内存缓存?"}
    S2 -->|有| Out
    S2 -->|无| S3["Provider.getTranscriptHistory\n读取 ~/.claude 的 .jsonl"]
    S3 --> Out
    Out --> Render["xterm 写入回放内容"]
    Render --> Notice["显示 'Ended history · Resume to interact'"]
```

## 关键设计点

- **协议**：前端到后端是请求/响应式命令（`session.*`、`terminal.*`），后端到前端是事件广播（`terminal.output`、`session.status`、`session.updated`）。`request()` 用 id 匹配响应，`onMessage()` 处理事件。
- **状态机**：`draft → starting → running → ended`（`SESSION_STATUS` 中还有 `idle`）。状态变更通过 `onStatusChange` 监听器全量广播。
- **进程托管**：`SessionManager` 用 `processes` Map 持有 PTY 进程；`reconcileDetachedLiveSessions()` 在启动时把没有对应进程却仍标记为存活的会话纠正为 `ended`。
- **输出多级缓存**：实时 `RingBuffer`（内存）+ SQLite 持久化 + Claude transcript 文件回退，保证会话重连后能恢复历史。
- **标题自动生成**：`recordTerminalInput` 捕获首条用户输入，提炼成会话标题。
