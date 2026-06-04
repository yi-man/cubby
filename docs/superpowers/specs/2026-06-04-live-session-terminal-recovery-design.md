# Live Session Terminal Recovery

## Goal

Improve live session terminal continuity when the user switches sessions, refreshes the browser, or reconnects the WebSocket while the server-side Claude PTY is still alive.

The target behavior is:

- A live terminal should not duplicate already-rendered output after remount.
- A live terminal should fill any missing output that is still available in memory.
- If the browser is already caught up, it should do nothing.
- If the server no longer has enough live history, the UI should show a clear recovery failure instead of silently painting a corrupted screen.

This design intentionally does not add Coder Studio's headless terminal snapshot layer yet. The first step is to add a sequence-based recovery protocol around Cubby's current session terminal model.

## Current Problem

Cubby's current replay path is chunk-based but not sequence-aware.

The browser calls `terminal.replay` for live and ended sessions, then writes every returned string chunk into xterm. Live output events are also written directly as they arrive. Because neither side tracks the rendered output position, the app cannot reliably distinguish:

- history that is already rendered,
- history that was missed during a switch or refresh,
- live output that arrives while replay is in progress,
- output that has been evicted from memory and can no longer be recovered.

This leads to duplicated output, stale history being appended to new live output, and no principled recovery path when a gap is detected.

## Reference Model

Coder Studio solves this with:

- monotonically increasing terminal output sequence numbers,
- a client-rendered sequence watermark,
- `recovery.reconcile` to choose `noop`, `replay`, `snapshot`, `closed`, or `unrecoverable`,
- `terminal.replay(lastSeq)` to fetch only missing bytes,
- optional `terminal.snapshot` when replay is too old.

Cubby should adopt the sequence and reconcile model first, but defer snapshot support.

## Scope

Included:

- Add sequence metadata to live terminal output.
- Track the latest rendered sequence in `SessionView`.
- Change live replay to request missing output from `lastSeq`.
- Add `recovery.reconcile` for live sessions.
- Detect and recover live output gaps.
- Keep ended-session replay behavior working with minimal changes.

Not included:

- Headless xterm snapshot rendering.
- Binary terminal transport.
- Full TerminalManager/sessionId-terminalId split.
- Multi-terminal support.
- Recovery across server restarts for processes that cannot survive the restart.

## Protocol

### Terminal Output Event

Current:

```ts
{ evt: "terminal.output", data: { sessionId, data } }
```

New:

```ts
{
  evt: "terminal.output",
  data: {
    sessionId: string;
    data: string;
    seqStart: number;
    seq: number;
  };
}
```

`seq` is the cumulative UTF-8 byte position after the chunk. `seqStart` is the cumulative byte position before the chunk.

### Terminal Replay

Current:

```ts
terminal.replay({ sessionId }) -> { sessionId, chunks: string[] }
```

New:

```ts
terminal.replay({ sessionId, lastSeq?: number }) ->
  | { status: "ok"; sessionId: string; chunks: TerminalReplayChunk[]; seq: number }
  | { status: "too_old"; sessionId: string; oldestSeq: number; seq: number }
  | { status: "unknown"; sessionId: string };

type TerminalReplayChunk = {
  data: string;
  seqStart: number;
  seq: number;
};
```

For live sessions, `lastSeq` means "return chunks strictly after this rendered position." If `lastSeq` is older than the oldest chunk in memory, return `too_old`. If `lastSeq` equals the current head sequence, return `ok` with an empty chunk list.

For ended sessions, Cubby can continue returning full sanitized history for now by treating missing or zero `lastSeq` as full replay. Ended recovery is not the focus of this change.

### Recovery Reconcile

Add:

```ts
recovery.reconcile({
  sessionId: string;
  renderedSeq: number;
}) ->
  | { action: "noop"; sessionId: string; headSeq: number }
  | { action: "replay"; sessionId: string; fromSeq: number; headSeq: number }
  | { action: "closed"; sessionId: string; headSeq: number; exitCode?: number | null }
  | { action: "unrecoverable"; sessionId: string; reason: "too_old_no_snapshot" | "unknown_session" };
```

Decision rules:

- If session is unknown, return `unrecoverable: unknown_session`.
- If session is live and `renderedSeq === headSeq`, return `noop`.
- If session is live and ring buffer can replay from `renderedSeq`, return `replay`.
- If session is live but replay is too old, return `unrecoverable: too_old_no_snapshot`.
- If session has ended and `renderedSeq >= headSeq`, return `closed`.
- If session has ended and replay is available, return `replay` with closed state added later when needed.

## Server Design

### Sequence-Aware Buffer

Replace the current string-only `RingBuffer` behavior for terminal output with sequence-aware chunks:

```ts
interface TerminalOutputChunk {
  data: string;
  seqStart: number;
  seq: number;
}
```

The session manager owns the cumulative sequence per session. When PTY output arrives:

1. Compute `byteLength` with `Buffer.byteLength(data, "utf8")`.
2. Create `{ data, seqStart, seq: seqStart + byteLength }`.
3. Store it in the in-memory output buffer.
4. Persist the chunk as best effort for ended history.
5. Broadcast `terminal.output` with the same sequence metadata.

The ring buffer should be able to answer:

- `headSeq(sessionId)`,
- `oldestSeq(sessionId)`,
- `canReplayFrom(lastSeq)`,
- `replayFrom(lastSeq)`.

### Persistence

For this live-recovery phase, in-memory sequence correctness is the source of truth. SQLite persistence should not block the feature.

If the existing `terminal_outputs` table is extended, use nullable sequence columns so existing local databases remain readable:

```sql
seq_start INTEGER;
seq_end INTEGER;
```

If those columns are absent in an existing DB, the server should still boot and use in-memory recovery for live sessions.

### WebSocket Handler

Add `recovery.reconcile` handling beside the current session and terminal commands.

Update `terminal.replay` to accept `lastSeq` and return status-shaped responses. Keep backward compatibility for callers that do not pass `lastSeq` during the transition.

## Frontend Design

`SessionView` owns four live recovery refs:

- `renderedSeqRef`: highest sequence fully written to xterm.
- `pendingLiveChunksRef`: live chunks received while recovery is in flight.
- `recoveryGenerationRef`: cancels stale replay/reconcile work during rapid session switches.
- `initialRecoveryDoneRef`: prevents live chunks from painting before the first reconcile finishes.

On live session mount:

1. Wait until xterm is ready.
2. Start a new recovery generation and set `initialRecoveryDoneRef` to false.
3. Subscribe to live output. The message handler buffers every live chunk while initial recovery is incomplete.
4. Call `recovery.reconcile({ sessionId, renderedSeq })`.
5. If `noop`, mark ready.
6. If `replay`, call `terminal.replay({ sessionId, lastSeq: fromSeq })`, write replay chunks in order, then flush pending live chunks with `seq > replaySeq`.
7. If `unrecoverable`, reset xterm and show a compact recovery error state for that session.
8. Set `initialRecoveryDoneRef` to true only after the chosen recovery action completes.

On live output:

- If initial recovery is not done, buffer the chunk.
- If no recovery is in flight and `chunk.seqStart <= renderedSeqRef.current`, write the chunk only if `chunk.seq > renderedSeqRef.current`.
- If `chunk.seqStart > renderedSeqRef.current`, buffer it and trigger `recovery.reconcile` for a `seq_gap`.
- If recovery is in flight, buffer live chunks until recovery finishes.

When writing any replay or live chunk, update `renderedSeqRef.current` only after the xterm write callback resolves.

## Error Handling

- `too_old_no_snapshot`: show "Terminal history is no longer available. Restart or resume the session." Do not keep appending live chunks to a known-corrupt screen.
- replay request timeout or command failure: show a retryable recovery notice and allow retry.
- stale generation: silently ignore old replay/reconcile responses.
- session ended during recovery: apply available replay, then mark terminal closed if the server returns `closed`.

## Testing

Server unit tests:

- Ring buffer replays from an exact sequence.
- Ring buffer returns `too_old` when the requested sequence is before the oldest retained chunk.
- `recovery.reconcile` returns `noop`, `replay`, `closed`, and `unrecoverable`.
- `terminal.output` broadcasts include `seqStart` and `seq`.

Frontend unit tests:

- Live mount calls `recovery.reconcile` before replay.
- `noop` does not reset or rewrite terminal output.
- `replay` writes only missing chunks and advances `renderedSeq`.
- Live output during replay is buffered and flushed after replay.
- A live seq gap triggers reconcile.
- `too_old_no_snapshot` shows a recovery error and stops painting live chunks into a corrupt screen.

E2E tests:

- Switch away from a running session, produce output, switch back, and verify no duplicate output.
- Refresh the browser while a mock live session is running and verify missing output is replayed once.
- Simulate dropped live output and verify recovery replays the missing range.

## Migration Strategy

1. Add sequence-aware buffer and new response shapes behind the existing command names.
2. Update frontend live-session path to use `recovery.reconcile`.
3. Keep ended-session replay compatible with the old all-history behavior.
4. Once live recovery is stable, evaluate whether ended-session replay should also move fully to the same sequence model.

## Open Decisions Resolved

- Use UTF-8 byte offsets for sequence numbers, not chunk counts.
- Keep JSON transport for now.
- Do not introduce snapshot support in this phase.
- Do not split session and terminal ids yet; `sessionId` remains the terminal recovery identity.
