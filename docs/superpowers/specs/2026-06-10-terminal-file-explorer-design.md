# Terminal File Explorer Design

## Goal

Add a read-only file explorer below the session terminal so users can inspect the current workspace without leaving Cubby.

## Scope

- Add a compact `File Explorer` action below the terminal area.
- Open a modal rooted at the active session `workspaceId`.
- Let users navigate directories one level at a time.
- Let users click previewable text files and read their contents in the modal.
- Keep all browse and read operations inside the workspace root.

## Architecture

The server keeps the filesystem boundary. `/api/browse` accepts an optional `root` parameter; when present, both `root` and `path` are resolved and `path` must stay inside `root`. A new `/api/file` route reads a bounded text preview from a file under `root`.

The web app adds a focused file-explorer component under `packages/web/src/components/workspace`. `SessionView` owns only the open/close state and passes `session.workspaceId` as the root. The explorer component owns directory loading, parent navigation, file selection, loading states, and errors.

## UX

The terminal remains the primary surface. A short bottom toolbar contains a folder icon and `File Explorer` label. The modal uses the existing dark, dense Cubby style. On desktop, directory entries and file preview sit side by side. On narrow screens, they stack.

Directory rows enter folders. File rows open previews. Non-previewable files show a short message rather than raw binary output. Large files are capped by the server and marked as truncated.

## Error Handling

- Inaccessible directories return a route error and show a concise UI error.
- Paths outside the root return 403.
- Missing paths return 404.
- Binary or oversized files do not break the modal.

## Testing

- Server tests cover root-restricted browsing, traversal rejection, text file reads, and binary rejection.
- Web logic tests cover response validation and parent path calculation.
- Manual/browser verification checks the modal opens from the terminal and can navigate and preview files.
