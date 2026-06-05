# Session Tab Polish Design

## Context

Cubby already has a React sidebar grouped by workspace, a session detail pane with xterm, and a WebSocket command model for session lifecycle actions. The requested work is a focused polish pass on session tabs and desktop layout:

- Show clearer running vs ended state and play a sound when a live session ends.
- Remove the workspace-level session count.
- Sort tabs with the active session first, then by recent activity.
- Allow renaming and deleting sessions.
- Let desktop users drag-resize the left sidebar.
- Fix session search so provider values such as `claude-code` filter correctly.
- Add padding around the right terminal.
- Change currently gray-white text values to true white where they represent white text.

This design intentionally does not add the full notification settings system from the PRD. The end sound is implemented as a small browser-side behavior.

## Recommended Approach

Add the missing durable session operations to the server, then wire the existing UI to those commands. This keeps rename and delete persistent, avoids local-only state, and follows the existing `session.start`, `session.kill`, `session.list`, and `session.updated` patterns.

Frontend-only rename/delete is rejected because refresh would lose changes and deleted sessions would remain in SQLite. A full notification subsystem is rejected as too broad for these small requirements.

## Behavior

### Session State And Finish Sound

The UI continues to use the existing session statuses:

- `draft`: session exists but has not started.
- `starting`: process is being spawned.
- `running`: process is active.
- `ended`: process exited or was killed.
- `idle`: supported by the shared type, handled as a non-live ready state.

Session tabs and the detail header visually distinguish live statuses (`starting` and `running`) from ended sessions. The status label is explicit enough for tooltips and accessibility text.

The browser tracks previous session statuses after initial load. When a session transitions from `starting` or `running` to `ended`, the app plays a short completion sound. Existing ended sessions loaded on page open do not play sound. If the browser blocks audio because the page has not received user interaction, the error is ignored.

The sound is generated with Web Audio API instead of adding an audio file. This keeps the feature self-contained while matching the short notification style requested.

### Sidebar List

Workspace headers no longer show the total session count.

Within each workspace, sessions are sorted before visibility limiting:

1. Current active session first.
2. Remaining sessions by descending `updatedAt`.
3. If timestamps tie, use descending `createdAt`.

This uses existing fields. `updatedAt` is updated by status changes and title changes, which is close enough to "recently run" without introducing a new database column.

The search filter matches normalized text across:

- session title or provider fallback
- provider
- workspace full path
- workspace basename
- status
- session id

Queries such as `claude-code` must match provider-only sessions even when the visible title is a custom title.

The current five-visible-sessions behavior and "More N" overflow remain, but they operate on the sorted and filtered list.

### Rename

Each session tab exposes a rename action. Rename opens an inline editor or compact popover consistent with the current sidebar style.

Submitting a non-empty title sends `session.rename` over WebSocket. The server trims the title and persists it. Empty titles are rejected client-side and server-side. On success, the server returns and broadcasts the updated session, so all connected clients update consistently.

The existing automatic title-from-first-input behavior must not overwrite a manually renamed title because it already avoids replacing non-slash titles.

### Delete

Each session tab exposes a delete action. Delete always asks for confirmation.

If the session is `starting` or `running`, confirmed deletion first stops the process and marks it ended, then deletes the session data. The confirmation text states that running work will stop.

Deleting a session removes:

- the `sessions` row
- related `terminal_outputs`
- related `terminal_snapshots`
- any in-memory process, output buffer, snapshot buffer, first-input buffer, and resume-input-reset state

After deleting the current session, the frontend selects the next preferred session from the remaining list. If none remains, it clears the current selection and shows the empty state.

The server broadcasts a deletion event so other connected clients remove the session without waiting for the next `session.list`.

### Desktop Sidebar Resize

Desktop sidebar width becomes user-resizable with a drag handle on the right edge. The width is persisted in local storage.

Constraints:

- Minimum: `200px`
- Maximum: `420px`
- Default: `240px`
- Mobile keeps the existing overlay width and does not expose resizing.
- Collapsing the sidebar still sets width to `0px`, but the last expanded desktop width is preserved.

The drag handle uses pointer events and sets capture during dragging. While dragging, text selection is suppressed.

### Terminal Padding

The session detail pane adds padding around the terminal area so xterm content no longer touches the right edge. Because xterm fits to its container, the padding wraps the terminal container and is not applied inside xterm internals.

For live sessions, terminal resize messages remain governed by the existing `resizeAuthorityRef` rules. Padding changes can alter the active terminal column count, which is acceptable when the active browser owns resize authority.

### White Text

White foreground values that currently render as gray-white become true white:

- xterm `foreground`
- xterm `white`
- visible UI text values that currently use `#d7d7d2`, `#dedbd2`, `#d8d8d4`, or equivalent gray-white where the intent is white

Muted metadata, borders, and secondary labels remain muted. This change is not a global palette rewrite.

## Server Design

### Shared Commands

Add WebSocket commands:

- `session.rename`
- `session.delete`

Add WebSocket event:

- `session.deleted`

`session.rename` args:

```ts
{ sessionId: string; title: string }
```

`session.delete` args:

```ts
{ sessionId: string }
```

`session.deleted` data:

```ts
{ sessionId: string }
```

### SessionStore

Add:

- `delete(id: string): boolean`

The method deletes dependent terminal rows before deleting the session. It returns whether a session row was removed.

### SessionManager

Add:

- `renameSession(sessionId: string, title: string): Session`
- `deleteSession(sessionId: string): Promise<boolean>`

`renameSession` validates a non-empty trimmed title, updates the store, and returns the updated session or throws if the session is missing.

`deleteSession` stops live processes if present, clears in-memory state, deletes persisted dependent data, deletes the session row, and returns whether anything was deleted.

### HTTP Routes

Mirror the WebSocket operations for tests and API consistency:

- `PATCH /api/sessions/:id` with `{ title }`
- `DELETE /api/sessions/:id`

## Frontend Design

### App

`App` handles new events:

- `session.updated`: update or insert the session in local state.
- `session.deleted`: remove the session from local state, clear pending state if needed, and select the next preferred session if the deleted session was current.

`App` also tracks status transitions for the completion sound. The tracker initializes from the first list without sound, then reacts to later changes.

Desktop sidebar width state is added alongside existing collapse state:

- `cubby.sidebarWidth`
- existing `cubby.sidebarCollapsed`

### SessionList

`SessionList` receives callbacks:

- `onRename(id, title)`
- `onDelete(id)`

It owns local editing UI state only. Persistent changes remain in `App` and the server.

Helper logic for search and sorting is extracted into pure functions and covered by unit tests.

### SessionView And TerminalView

`SessionView` wraps the terminal with padding. `TerminalView` keeps the xterm container full-size inside its parent.

`TerminalView` updates the xterm theme to true white foreground values.

## Error Handling

Rename failures leave the old title visible and exit edit mode only after a successful response. Client-side validation prevents empty submissions.

Delete failures keep the tab visible. If deletion fails after stopping a live process, the session may remain ended; the server returns the failure, and the next `session.list` reconciles UI state.

Audio playback failures are ignored because browser autoplay policies are outside application control.

## Testing

### Unit And Integration

- `SessionStore.delete` removes a session and terminal-dependent rows.
- `SessionManager.renameSession` persists title and rejects missing or empty titles.
- `SessionManager.deleteSession` kills live processes, clears state, and removes persisted data.
- `WSCommandHandler` handles `session.rename`, broadcasts `session.updated`, handles `session.delete`, and broadcasts `session.deleted`.
- Session list pure helpers sort active first and then by recent timestamps.
- Search helper matches provider `claude-code` even when title is custom.

### E2E

- Searching `claude-code` filters sessions correctly.
- Workspace header no longer shows the session count.
- Active session appears before newer non-active sessions.
- Rename changes the tab, header, and persists after reload.
- Delete requires confirmation and removes the tab; deleting a running session stops it first.
- Desktop sidebar drag changes width and persists after reload.
- Mobile sidebar behavior remains unchanged.
- Terminal pane has visible padding.
- xterm foreground and white theme values render as true white.
- Ending a live session triggers the browser sound path without playing on initial page load.

## Rollout Notes

This is a local schema-compatible change because no new database columns are required. The only persisted behavior change is deletion of session rows and their dependent terminal data when users confirm deletion.
