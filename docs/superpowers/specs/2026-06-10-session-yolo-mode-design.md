# Session Yolo Mode Design

## Context

Cubby creates agent sessions from the workspace picker, persists sessions in SQLite, and starts or resumes them through one of three providers:

- `claude-code`
- `codex`
- `opencode`

The current session model has provider, model, title, status, and provider session id, but no permission mode. Provider command arguments are built inside the server provider classes. The user wants every newly created session to be able to choose whether it runs in yolo mode. The default must be yolo enabled, and all three providers must support it.

## Decision

Persist yolo as a session property.

This keeps create, auto-start, manual start, resume, HTTP API, WebSocket API, service restart, and browser refresh behavior consistent. It also matches the requirement that the choice belongs to the newly created session, not only to one start attempt.

The rejected alternative is passing yolo only during start. That would be smaller initially but would lose the selection across refresh or resume and would create multiple sources of truth.

## Data Model

Add `yolo: boolean` to `Session`.

Add `yolo?: boolean` to `CreateSessionInput`.

Add a SQLite column:

```sql
yolo INTEGER NOT NULL DEFAULT 1
```

The runtime database initializer will migrate existing databases by adding the column when missing. Existing sessions become yolo sessions by default because the new column default is `1`.

`SessionStore.create` treats omitted yolo as `true`. `rowToSession` maps SQLite `1` to `true` and `0` to `false`.

## Protocol And APIs

`session.create` accepts:

```ts
{
  workspaceId: string;
  provider: string;
  model?: string;
  title?: string;
  yolo?: boolean;
}
```

HTTP `POST /api/sessions` accepts the same optional `yolo` field.

Both paths default missing `yolo` to `true`.

`SpawnOptions` gains `yolo?: boolean`. `SessionManager` reads the persisted session value and passes it into provider spawn options for both `startSession` and `resumeSession`.

Start and resume request payloads do not need a yolo field because the session already owns the setting.

## Provider Arguments

Claude Code:

- yolo on: append `--dangerously-skip-permissions`
- yolo off: no permission bypass flag

Codex:

- yolo on: append `--dangerously-bypass-approvals-and-sandbox`
- yolo off: no bypass flag

OpenCode:

- yolo off: keep the current TUI command shape, `opencode <cwd>` plus optional model and resume flags.
- yolo on: use `opencode run --interactive --dangerously-skip-permissions --dir <cwd>` plus optional model and resume flags.

OpenCode 1.16.2 exposes `--dangerously-skip-permissions` on `opencode run`, not in the top-level TUI help. The user approved using the direct interactive run path for yolo sessions.

## Frontend

The workspace picker adds a compact binary yolo control near the provider selector. It defaults to enabled.

On submit, `WorkspaceOpenSelection` includes:

```ts
{
  path: string;
  provider: AgentProviderId;
  yolo: boolean;
}
```

`App.handleDirConfirm` sends `{ workspaceId, provider, yolo }` in `session.create`.

The existing provider selection behavior stays unchanged.

## Error Handling

If a provider command rejects an unsupported yolo argument, the existing session start error path captures the error into terminal output, marks the session ended, and returns the start failure. No new error transport is required.

OpenCode yolo sessions intentionally take the `run --interactive` path so that the yolo flag is supported by the installed CLI contract.

## Testing

Follow test-first implementation.

Unit tests:

- `SessionStore` creates sessions with yolo defaulting to `true`.
- `SessionStore` persists explicit `false`.
- Database migration adds the yolo column for existing databases.
- `SessionManager` passes persisted yolo into provider spawn options for start and resume.
- Claude provider args include `--dangerously-skip-permissions` only when yolo is true.
- Codex provider args include `--dangerously-bypass-approvals-and-sandbox` only when yolo is true.
- OpenCode provider args use the `run --interactive --dangerously-skip-permissions --dir <cwd>` path when yolo is true and keep the current path when yolo is false.
- HTTP and WebSocket session create accept and return yolo.

E2E coverage:

- Workspace picker shows yolo enabled by default.
- Creating a session without toggling sends `yolo: true`.
- Disabling yolo sends `yolo: false`.
- Provider selection continues to work for Claude Code, Codex, and OpenCode.

## Out Of Scope

- Editing yolo mode after a session is created.
- Per-provider custom defaults.
- Global preference persistence for the default yolo toggle.
- Displaying yolo state in the session list or detail header.
