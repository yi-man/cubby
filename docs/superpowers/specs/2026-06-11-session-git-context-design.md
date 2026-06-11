# Session Git Context Design

## Goal

Show the Git context for the active session workspace. The existing toolbar already shows the current branch and change count. This feature keeps that behavior for normal branch development, adds linked-worktree identity when the session is running from a Git worktree, and shows a clickable open pull request link when one can be detected.

## Scope

- Use `session.workspaceId` as the source of truth.
- Detect whether that workspace is a linked Git worktree.
- Display the worktree name only when the session workspace is a linked worktree.
- Keep the existing branch-and-change-count display for normal repository checkouts.
- Detect an open GitHub pull request for the current branch when possible.
- Show a clickable PR link that opens in a new browser tab.
- Keep Git changes read-only.

## Non-Goals

- Tracking the terminal process current directory after the user runs `cd`.
- Switching branches or creating/removing worktrees.
- Creating, updating, merging, or closing pull requests.
- Adding GitLab, Bitbucket, or custom forge support in this iteration.
- Adding authentication settings UI for private repository PR lookup.

## Backend

Extend the existing `GET /api/git/status?root=<workspace>` response. This route already runs Git commands against `session.workspaceId`, which is the correct source of truth for this feature.

Add Git context fields:

```ts
interface GitStatusResponse {
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
  context?: {
    repoRoot: string;
    worktreeRoot: string;
    worktreeName: string | null;
    gitDir: string;
    gitCommonDir: string;
    isLinkedWorktree: boolean;
    headDetached: boolean;
    commit: string | null;
    remoteUrl: string | null;
    pullRequest: GitPullRequest | null;
  };
}

interface GitPullRequest {
  provider: 'github';
  number: number;
  title: string;
  url: string;
}
```

Use these commands with argument arrays and no shell:

```bash
git -C <workspace> rev-parse --show-toplevel
git -C <workspace> rev-parse --absolute-git-dir
git -C <workspace> rev-parse --git-common-dir
git -C <workspace> branch --show-current
git -C <workspace> rev-parse --short HEAD
git -C <workspace> remote get-url origin
```

`worktreeRoot` is the result of `rev-parse --show-toplevel`.

`repoRoot` is:

- `worktreeRoot` for ordinary repository checkouts.
- The directory that owns `gitCommonDir` for linked worktrees.

`isLinkedWorktree` is true when `absoluteGitDir` and `gitCommonDir` resolve to different paths. This distinguishes:

- Ordinary branch development: `.git` is both the Git dir and common dir.
- Linked worktree development: Git dir is under the main repository common dir, for example `.git/worktrees/session-git-context`.

`worktreeName` is `basename(worktreeRoot)` only when `isLinkedWorktree` is true. Otherwise it is null.

`headDetached` is true when `branch --show-current` returns an empty string while the workspace is a repository.

For non-Git workspaces, preserve the current successful response:

```ts
{ isRepo: false, branch: null, entries: [] }
```

If optional context commands fail after status succeeds, return the status response with the context fields that could be read. Do not fail the whole Git status endpoint because PR lookup or remote parsing failed.

## Pull Request Detection

Only GitHub is supported in this iteration.

Parse `origin` remote URLs in these forms:

```txt
git@github.com:owner/repo.git
https://github.com/owner/repo.git
https://github.com/owner/repo
```

When a GitHub remote and a non-detached branch are available, query:

```txt
GET https://api.github.com/repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open
```

Use a short timeout so Git status stays responsive. If the request fails, times out, returns unauthorized, or returns no matching PR, set `pullRequest` to null.

If the API returns open PRs, use the first result:

```ts
{
  provider: 'github',
  number: 8,
  title: 'Add terminal Git changes dialog',
  url: 'https://github.com/yi-man/cubby/pull/8'
}
```

No token storage or authentication UI is added. Public repositories work without configuration. Private repositories may not show PR links unless the network environment already allows the request.

## Frontend

Extend `GitStatusResponse` validation in `packages/web/src/components/workspace/git-status-model.ts`.

Add display helpers:

```ts
gitContextSummaryLabel(status)
gitPullRequestLabel(pullRequest)
```

Toolbar display:

- Ordinary repository checkout:
  ```txt
  feat/session-git-context · 12 changes
  ```
- Linked worktree:
  ```txt
  feat/session-git-context · worktree session-git-context · 12 changes
  ```
- Detached linked worktree:
  ```txt
  HEAD detached · worktree session-git-context · 12 changes
  ```
- Non-Git workspace:
  ```txt
  No Git repo
  ```

The Git Changes dialog header uses the same summary text. The secondary title or tooltip exposes the full `worktreeRoot` path when context is available.

When `pullRequest` is present, render a compact `PR #<number>` link near the Git summary. The link:

- Uses `href={pullRequest.url}`.
- Uses `target="_blank"`.
- Uses `rel="noreferrer noopener"`.
- Does not close the Git changes dialog.

If `pullRequest` is null, render nothing. Do not show a persistent error for failed PR lookup.

## Errors

- Non-repo workspaces keep the existing non-error state.
- Git context command failures should not block branch/change display.
- PR lookup failures are silent and only remove the PR link.
- Remote URLs that are not GitHub are ignored.
- Detached HEAD workspaces never attempt PR lookup.

## Testing

Server tests cover:

- Ordinary repo checkout returns `isLinkedWorktree: false`.
- Linked worktree checkout returns `isLinkedWorktree: true` and the worktree name.
- Detached HEAD returns `headDetached: true`.
- GitHub SSH and HTTPS remote URL parsing.
- Open GitHub PR response maps to `pullRequest`.
- PR network/API failures return `pullRequest: null`.

Frontend tests cover:

- Status response validation accepts the new context and PR fields.
- Ordinary repo summary matches the existing branch/count display.
- Linked worktree summary includes the worktree name.
- PR label formats as `PR #8`.

Browser verification covers:

- A normal branch workspace keeps the current toolbar shape.
- A linked worktree workspace shows `worktree <name>` in the Git toolbar/dialog.
- When the server returns a PR URL, the UI renders a `PR #<number>` link that opens a new tab.
