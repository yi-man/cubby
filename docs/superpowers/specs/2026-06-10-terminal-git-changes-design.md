# Terminal Git Changes Design

## Goal

Show Git context in the toolbar below the session terminal. Users should see the current branch and whether the workspace has changes, then open a Git changes dialog that lists modified files by directory and lets them inspect a file diff.

## Scope

- Add a compact Git control next to the existing File Explorer control below the terminal.
- Show the current branch name when the session workspace is a Git repository.
- Show a changed-file count for modified, staged, deleted, renamed, and untracked files.
- Open a modal from the Git control.
- Organize changed files by directory.
- Let users click any changed file.
- Show a diff for tracked changes.
- Show the current file content for untracked files, because there is no Git base revision.
- Keep this read-only. No stage, unstage, discard, commit, branch switch, pull, or push.

## Non-Goals

- Real-time file watching.
- Editing files from the Git changes dialog.
- Full Git operation support.
- Commit history or branch management.

## Backend

Add HTTP routes under the existing route registration:

- `GET /api/git/status?root=<workspace>`
- `GET /api/git/diff?root=<workspace>&path=<relative-or-absolute-file-path>`

Both routes reuse the workspace root safety model used by `/api/browse` and `/api/file`. A requested file path must resolve inside the workspace root before any Git command runs.

`/api/git/status` runs `git -C <root> status --porcelain=v1 -b`. The response includes:

- `isRepo`: whether the workspace is inside a Git repository.
- `branch`: current branch or detached commit label.
- `entries`: changed files with path, optional original path for renames, staged status, worktree status, and a normalized display status.

If the workspace is not a Git repository, return a successful non-repo response instead of surfacing a server error.

`/api/git/diff` runs Git only for files reported by path. It returns:

- For tracked worktree changes: `git diff -- <path>`.
- For staged-only changes: `git diff --cached -- <path>`.
- For files with both staged and worktree changes: both diffs concatenated with short section headers.
- For untracked files: file content from the same preview path used by `/api/file`, marked as `mode: "content"`.

Diff commands use argument arrays and `--` path separation. They do not invoke a shell.

## Frontend

Add a small Git status model under `packages/web/src/components/workspace` for response validation, changed-file labels, count formatting, and directory tree construction.

`SessionView` owns the Git toolbar state:

- Fetch status for `session.workspaceId`.
- Refresh when the active session changes and when the dialog opens.
- Render a compact Git button beside File Explorer.
- Display branch and count in the button when `isRepo` is true.
- Display a quiet `No Git repo` state when `isRepo` is false.

Add a `GitChanges` modal component with the same dense dark visual language as the file explorer:

- Header: branch, count, refresh, close.
- Left panel: changed files grouped by directory, with expandable folders.
- Right panel: Monaco read-only diff/text view.
- Mobile layout: files and preview become separate panels like the current file explorer.
- File entries show concise status chips such as `M`, `A`, `D`, `R`, and `??`.

Clicking a tracked file loads `/api/git/diff` and displays the diff as plain text with `diff` syntax highlighting. Clicking an untracked file displays its current content and labels the preview as untracked content.

## Errors

- Non-repo workspaces should not block terminal usage or file explorer usage.
- Status load failures show an inline error in the Git dialog and keep the toolbar usable.
- Diff load failures show an empty preview state with a concise error.
- Deleted files can still show a diff if Git can produce one.

## Testing

Unit and integration tests cover:

- Git status response validation.
- Directory tree construction from flat changed-file entries.
- Branch/count display helpers.
- Server parsing of porcelain status, including modified, staged, deleted, renamed, and untracked files.
- Server diff behavior for tracked, staged-only, mixed, deleted, and untracked files.
- Workspace path protection for Git diff requests.

Browser verification covers:

- The terminal toolbar shows branch and changed count.
- Opening the Git dialog shows changed files grouped by directory.
- Clicking a modified file shows a diff.
- A non-Git workspace shows a quiet non-repo state.
