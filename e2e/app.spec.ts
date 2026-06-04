import { expect, type Locator, type Page, test } from '@playwright/test';

interface SessionFixture {
  id: string;
  title: string;
  workspaceId: string;
  status: string;
}

const MOCK_CLAUDE_PROVIDER_ENABLED = process.env.CUBBY_MOCK_CLAUDE_PROVIDER === '1';
const ACTIVE_DRAFT_SESSION_BORDER = 'rgb(116, 80, 71)';

async function createSession(
  page: Page,
  input: { workspaceId: string; title: string },
): Promise<SessionFixture> {
  const response = await page.request.post('/api/sessions', {
    data: { workspaceId: input.workspaceId, provider: 'claude-code', title: input.title },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as SessionFixture;
}

async function startSession(page: Page, session: SessionFixture): Promise<void> {
  const response = await page.request.post(`/api/sessions/${session.id}/start`, {
    data: { cwd: session.workspaceId },
  });
  expect(response.ok()).toBeTruthy();
}

async function stopSession(page: Page, session: SessionFixture): Promise<void> {
  const response = await page.request.post(`/api/sessions/${session.id}/kill`);
  expect(response.ok()).toBeTruthy();
}

async function assertActiveDetail(
  page: Page,
  expected: { title: string; status: string; action: 'Start' | 'Stop' | 'Resume' },
): Promise<void> {
  const detail = page.getByTestId('session-detail-pane');
  await expect(detail.getByTestId('session-title')).toHaveText(expected.title);
  await expect(detail.getByTestId('session-status')).toHaveText(expected.status);
  await expect(detail.getByRole('button', { name: expected.action, exact: true })).toBeVisible();

  for (const action of ['Start', 'Stop', 'Resume'] as const) {
    if (action === expected.action) continue;
    await expect(detail.getByRole('button', { name: action, exact: true })).toHaveCount(0);
  }
}

async function terminalTextLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const rows = document.querySelector('.xterm-rows');
    return rows?.textContent?.trim().length ?? 0;
  });
}

async function terminalText(page: Page): Promise<string> {
  return page.locator('.xterm-rows').evaluate((element) => element.textContent ?? '');
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

async function selectSessionTab(group: Locator, title: string): Promise<void> {
  const visibleTab = group.getByRole('button', { name: `Session ${title}`, exact: true });
  const moreButton = group.getByRole('button', { name: /^More \d+$/ });
  await expect
    .poll(async () => (await visibleTab.count()) > 0 || (await moreButton.count()) > 0)
    .toBe(true);

  if ((await visibleTab.count()) > 0) {
    await visibleTab.click();
    return;
  }

  await moreButton.click();
  await group.getByRole('button', { name: `Session ${title}`, exact: true }).click();
}

test.describe('Cubby MVP', () => {
  test('app loads and shows empty state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Select or create a session')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Session' })).toBeVisible();
  });

  test('app controls render Lucide icons', async ({ page }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-lucide-controls-${stamp}`;
    await createSession(page, { workspaceId, title: `Lucide Controls ${stamp}` });

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await expect(page.getByTestId('sidebar-toggle').locator('svg.lucide')).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Toggle fullscreen' }).locator('svg.lucide'),
    ).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Settings' }).locator('svg.lucide')).toHaveCount(
      1,
    );
    await expect(
      page.getByRole('button', { name: 'New Session' }).locator('svg.lucide-plus'),
    ).toHaveCount(1);
    await expect(
      group.getByTestId('workspace-toggle').locator('svg.lucide-chevron-down'),
    ).toHaveCount(1);
  });

  test('chrome keeps search in the sidebar and titles the active session', async ({ page }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-chrome-${stamp}`;
    const session = await createSession(page, {
      workspaceId,
      title: `Chrome Layout ${stamp}`,
    });

    await page.goto('/');

    const header = page.getByTestId('app-header');
    const sidebar = page.getByTestId('sidebar-shell');
    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    const selectedSession = group.getByTestId('session-item').filter({ hasText: session.title });

    await expect(header).toContainText(session.title);
    await expect(header.getByLabel('Search sessions')).toHaveCount(0);
    await expect(sidebar.getByLabel('Search sessions')).toBeVisible();

    await expect
      .poll(() =>
        page
          .getByTestId('session-detail-pane')
          .evaluate(
            (pane) =>
              Array.from(pane.children).filter(
                (child) => child.tagName === 'SPAN' && child.getAttribute('aria-hidden') === 'true',
              ).length,
          ),
      )
      .toBe(0);
    await expect
      .poll(() =>
        selectedSession.evaluate((item) =>
          Array.from(item.children).some(
            (child) => child.tagName === 'SPAN' && child.getAttribute('aria-hidden') === 'true',
          ),
        ),
      )
      .toBe(false);
  });

  test('app shell fills the viewport with no browser default gaps', async ({ page }) => {
    await page.goto('/');

    const metrics = await page.evaluate(() => {
      const root = document.getElementById('root');
      const bodyRect = document.body.getBoundingClientRect();
      const rootRect = root?.getBoundingClientRect();
      return {
        bodyMargin: getComputedStyle(document.body).margin,
        bodyRect: {
          x: bodyRect.x,
          y: bodyRect.y,
          width: bodyRect.width,
          height: bodyRect.height,
        },
        rootRect: rootRect
          ? { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height }
          : null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });

    expect(metrics.bodyMargin).toBe('0px');
    expect(metrics.rootRect).not.toBeNull();
    expect(metrics.rootRect?.x).toBe(0);
    expect(metrics.rootRect?.y).toBe(0);
    expect(metrics.rootRect?.width).toBe(metrics.viewport.width);
    expect(metrics.rootRect?.height).toBe(metrics.viewport.height);
  });

  test('sidebar is expanded by default on desktop and remembers user collapse state', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const sidebar = page.getByTestId('sidebar-shell');
    const detail = page.getByTestId('session-detail-pane');
    await expect(page.getByTestId('app-header')).toBeVisible();
    await expect(sidebar).toHaveCSS('width', '240px');
    await expect(page.getByRole('button', { name: 'New Session' })).toBeVisible();

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(sidebar).toHaveCSS('width', '0px');
    await expect(page.getByRole('button', { name: 'New Session' })).toHaveCount(0);
    await expect
      .poll(async () => {
        return Math.round(
          await detail.evaluate((element) => element.getBoundingClientRect().width),
        );
      })
      .toBe(1280);

    await page.reload();
    await expect(sidebar).toHaveCSS('width', '0px');

    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(sidebar).toHaveCSS('width', '240px');
    await expect(page.getByRole('button', { name: 'New Session' })).toBeVisible();

    await page.reload();
    await expect(sidebar).toHaveCSS('width', '240px');
    await expect(page.getByRole('button', { name: 'New Session' })).toBeVisible();
  });

  test('sidebar is collapsed by default on mobile without stored browser state', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const sidebar = page.getByTestId('sidebar-shell');
    await expect(sidebar).toHaveCSS('width', '0px');
    await expect(page.getByRole('button', { name: 'New Session' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(sidebar).toHaveCSS('width', '240px');
    await expect(page.getByRole('button', { name: 'New Session' })).toBeVisible();
  });

  test('switching sessions resets the right terminal pane', async ({ page }) => {
    const firstTitle = `Switch First ${Date.now()}`;
    const secondTitle = `Switch Second ${Date.now()}`;

    await page.request.post('/api/sessions', {
      data: { workspaceId: '/tmp', provider: 'claude-code', title: firstTitle },
    });
    await page.request.post('/api/sessions', {
      data: { workspaceId: '/tmp', provider: 'claude-code', title: secondTitle },
    });

    await page.goto('/');
    await page.getByTestId('session-item').filter({ hasText: firstTitle }).click();
    await assertActiveDetail(page, { title: firstTitle, status: 'draft', action: 'Start' });
    await expect(page.locator('.xterm-rows')).toBeVisible();

    await page.evaluate(() => {
      document.querySelector('.xterm-rows')?.setAttribute('data-session-marker', 'first');
    });

    await page.getByTestId('session-item').filter({ hasText: secondTitle }).click();
    await assertActiveDetail(page, { title: secondTitle, status: 'draft', action: 'Start' });
    await expect(page.locator('.xterm-rows[data-session-marker="first"]')).toHaveCount(0);
  });

  test('switching back to a running session replays its terminal history', async ({ page }) => {
    const firstTitle = `Replay First ${Date.now()}`;
    const secondTitle = `Replay Second ${Date.now()}`;

    await page.request.post('/api/sessions', {
      data: { workspaceId: '/tmp', provider: 'claude-code', title: firstTitle },
    });
    await page.request.post('/api/sessions', {
      data: { workspaceId: '/tmp', provider: 'claude-code', title: secondTitle },
    });

    await page.goto('/');
    await page.getByTestId('session-item').filter({ hasText: firstTitle }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await assertActiveDetail(page, { title: firstTitle, status: 'running', action: 'Stop' });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const rows = document.querySelector('.xterm-rows');
            return rows?.textContent?.trim().length ?? 0;
          }),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);

    await page.getByTestId('session-item').filter({ hasText: secondTitle }).click();
    await assertActiveDetail(page, { title: secondTitle, status: 'draft', action: 'Start' });

    await page.getByTestId('session-item').filter({ hasText: firstTitle }).click();
    await assertActiveDetail(page, { title: firstTitle, status: 'running', action: 'Stop' });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const rows = document.querySelector('.xterm-rows');
            return rows?.textContent?.trim().length ?? 0;
          }),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
  });

  test('selecting a running session does not force a terminal redraw resize', async ({ page }) => {
    test.skip(
      !MOCK_CLAUDE_PROVIDER_ENABLED,
      'Requires CUBBY_MOCK_CLAUDE_PROVIDER=1 to start a deterministic running session',
    );

    await page.addInitScript(() => {
      const observedWindow = window as typeof window & { __wsCommands?: unknown[] };
      observedWindow.__wsCommands = [];
      const NativeWebSocket = window.WebSocket;

      window.WebSocket = class CommandLoggingWebSocket extends NativeWebSocket {
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          try {
            observedWindow.__wsCommands?.push(JSON.parse(String(data)));
          } catch {}
          return super.send(data);
        }
      };
    });

    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-running-no-redraw-${stamp}`;
    const running = await createSession(page, {
      workspaceId,
      title: `Running No Redraw ${stamp}`,
    });
    await startSession(page, running);

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, running.title);
    await assertActiveDetail(page, { title: running.title, status: 'running', action: 'Stop' });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const commands =
              (window as typeof window & { __wsCommands?: Array<{ cmd?: string }> }).__wsCommands ??
              [];
            return commands.some((command) => command.cmd === 'terminal.subscribe');
          }),
        { timeout: 10000 },
      )
      .toBe(true);

    const redrawCommands = await page.evaluate(() => {
      const commands =
        (window as typeof window & { __wsCommands?: Array<{ id?: string; cmd?: string }> })
          .__wsCommands ?? [];
      return commands.filter(
        (command) =>
          command.cmd === 'terminal.resize' &&
          (command.id?.startsWith('redraw-start-') || command.id?.startsWith('redraw-finish-')),
      );
    });
    expect(redrawCommands).toEqual([]);
  });

  test('selecting a running session subscribes before replaying terminal history', async ({
    page,
  }) => {
    test.skip(
      !MOCK_CLAUDE_PROVIDER_ENABLED,
      'Requires CUBBY_MOCK_CLAUDE_PROVIDER=1 to start a deterministic running session',
    );

    await page.addInitScript(() => {
      const observedWindow = window as typeof window & { __wsCommands?: unknown[] };
      observedWindow.__wsCommands = [];
      const NativeWebSocket = window.WebSocket;

      window.WebSocket = class CommandLoggingWebSocket extends NativeWebSocket {
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          try {
            observedWindow.__wsCommands?.push(JSON.parse(String(data)));
          } catch {}
          return super.send(data);
        }
      };
    });

    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-running-subscribe-first-${stamp}`;
    const running = await createSession(page, {
      workspaceId,
      title: `Running Subscribe First ${stamp}`,
    });
    await startSession(page, running);

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, running.title);
    await assertActiveDetail(page, { title: running.title, status: 'running', action: 'Stop' });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const commands =
              (window as typeof window & { __wsCommands?: Array<{ cmd?: string }> }).__wsCommands ??
              [];
            return (
              commands.some((command) => command.cmd === 'terminal.subscribe') &&
              commands.some((command) => command.cmd === 'terminal.replay')
            );
          }),
        { timeout: 10000 },
      )
      .toBe(true);

    const terminalCommands = await page.evaluate(() => {
      const commands =
        (window as typeof window & { __wsCommands?: Array<{ cmd?: string }> }).__wsCommands ?? [];
      return commands
        .map((command) => command.cmd)
        .filter((cmd) => cmd === 'terminal.subscribe' || cmd === 'terminal.replay');
    });
    const subscribeIndex = terminalCommands.indexOf('terminal.subscribe');
    const replayIndex = terminalCommands.indexOf('terminal.replay');
    expect(subscribeIndex).toBeGreaterThanOrEqual(0);
    expect(replayIndex).toBeGreaterThanOrEqual(0);
    expect(subscribeIndex).toBeLessThan(replayIndex);
  });

  test('new session button opens workspace picker', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'New Session' }).click();

    await expect(page.getByRole('dialog', { name: 'Open Workspace' })).toBeVisible();
    await expect(page.getByLabel('Workspace path')).toBeVisible();
  });

  test('session list shows sessions', async ({ page }) => {
    const title = `Test Session ${Date.now()}`;
    // Create a session via API first
    const response = await page.request.post('/api/sessions', {
      data: { workspaceId: '/tmp', provider: 'claude-code', title },
    });
    expect(response.ok()).toBeTruthy();

    await page.goto('/');

    // Session should appear in list
    await expect(page.getByTestId('session-item').filter({ hasText: title })).toHaveCount(1, {
      timeout: 5000,
    });
  });

  test('slash command session tabs render distinctly and select exactly', async ({ page }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-slash-tabs-${stamp}`;
    const theme = await createSession(page, { workspaceId, title: '/theme' });
    const th = await createSession(page, { workspaceId, title: '/th' });

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await expect(group.getByTestId('session-command-prefix')).toHaveCount(2);
    await expect(
      group.getByTestId('session-command-title').filter({ hasText: /^theme$/ }),
    ).toHaveCount(1);
    await expect(
      group.getByTestId('session-command-title').filter({ hasText: /^th$/ }),
    ).toHaveCount(1);

    await group.getByRole('button', { name: `Session ${th.title}`, exact: true }).click();
    await assertActiveDetail(page, { title: th.title, status: 'draft', action: 'Start' });

    await group.getByRole('button', { name: `Session ${theme.title}`, exact: true }).click();
    await assertActiveDetail(page, { title: theme.title, status: 'draft', action: 'Start' });
  });

  test('loads existing sessions with an active detail pane', async ({ page }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-autoselect-${stamp}`;
    await createSession(page, { workspaceId, title: `Older Autoselect ${stamp}` });
    const latest = await createSession(page, { workspaceId, title: `Latest Autoselect ${stamp}` });

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, latest.title);
    await assertActiveDetail(page, {
      title: latest.title,
      status: 'draft',
      action: 'Start',
    });
    await expect(
      page
        .getByTestId('workspace-group')
        .filter({ hasText: workspaceId })
        .getByTestId('session-item')
        .filter({
          hasText: latest.title,
        }),
    ).toHaveCSS('border-color', ACTIVE_DRAFT_SESSION_BORDER);
  });

  test('refresh keeps the selected session tab active', async ({ page }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-refresh-selected-${stamp}`;
    const first = await createSession(page, {
      workspaceId,
      title: `Refresh Selected First ${stamp}`,
    });
    await createSession(page, {
      workspaceId,
      title: `Refresh Selected Latest ${stamp}`,
    });

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, first.title);
    await assertActiveDetail(page, {
      title: first.title,
      status: 'draft',
      action: 'Start',
    });

    await page.reload();

    await assertActiveDetail(page, {
      title: first.title,
      status: 'draft',
      action: 'Start',
    });
    await expect(group.getByTestId('session-item').filter({ hasText: first.title })).toHaveCSS(
      'border-color',
      ACTIVE_DRAFT_SESSION_BORDER,
    );
  });

  test('default active session prefers running work over newer ended empty sessions', async ({
    page,
  }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-default-running-${stamp}`;
    const running = await createSession(page, {
      workspaceId,
      title: `Default Running ${stamp}`,
    });
    await startSession(page, running);
    const ended = await createSession(page, {
      workspaceId,
      title: `Default Empty Ended ${stamp}`,
    });
    await stopSession(page, ended);

    await page.goto('/');

    await assertActiveDetail(page, {
      title: running.title,
      status: 'running',
      action: 'Stop',
    });
  });

  test('ended session without captured history shows a visible empty state', async ({ page }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-ended-empty-${stamp}`;
    const ended = await createSession(page, {
      workspaceId,
      title: `Ended Empty ${stamp}`,
    });
    await stopSession(page, ended);

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, ended.title);
    await assertActiveDetail(page, {
      title: ended.title,
      status: 'ended',
      action: 'Resume',
    });
    await expect(page.getByTestId('empty-terminal-history')).toBeVisible();
    await expect(page.locator('.xterm')).toBeVisible();
  });

  test('workspace tabs switch the right pane to that workspace session', async ({ page }) => {
    const stamp = Date.now();
    const firstWorkspaceId = `/tmp/cubby-workspace-a-${stamp}`;
    const secondWorkspaceId = `/tmp/cubby-workspace-b-${stamp}`;
    const second = await createSession(page, {
      workspaceId: secondWorkspaceId,
      title: `Workspace B ${stamp}`,
    });
    const first = await createSession(page, {
      workspaceId: firstWorkspaceId,
      title: `Workspace A ${stamp}`,
    });

    await page.goto('/');

    await page
      .getByTestId('workspace-group')
      .filter({ hasText: firstWorkspaceId })
      .getByTestId('workspace-tab')
      .click();

    await assertActiveDetail(page, {
      title: first.title,
      status: 'draft',
      action: 'Start',
    });

    await page
      .getByTestId('workspace-group')
      .filter({ hasText: secondWorkspaceId })
      .getByTestId('workspace-tab')
      .click();

    await assertActiveDetail(page, {
      title: second.title,
      status: 'draft',
      action: 'Start',
    });
  });

  test('session tab switching shows correct detail for draft running and ended states', async ({
    page,
  }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-state-tabs-${stamp}`;
    const draft = await createSession(page, { workspaceId, title: `State Draft ${stamp}` });
    const running = await createSession(page, { workspaceId, title: `State Running ${stamp}` });
    const ended = await createSession(page, { workspaceId, title: `State Ended ${stamp}` });
    for (let i = 1; i <= 4; i++) {
      await createSession(page, { workspaceId, title: `State Filler ${i} ${stamp}` });
    }
    await startSession(page, running);
    await startSession(page, ended);
    await stopSession(page, ended);

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await expect(group.getByTestId('session-item')).toHaveCount(5);

    await selectSessionTab(group, draft.title);
    await assertActiveDetail(page, {
      title: draft.title,
      status: 'draft',
      action: 'Start',
    });
    await expect(group.getByTestId('session-item').filter({ hasText: draft.title })).toHaveCount(1);

    await selectSessionTab(group, running.title);
    await assertActiveDetail(page, {
      title: running.title,
      status: 'running',
      action: 'Stop',
    });
    await expect(group.getByTestId('session-item').filter({ hasText: running.title })).toHaveCount(
      1,
    );

    await selectSessionTab(group, ended.title);
    await assertActiveDetail(page, {
      title: ended.title,
      status: 'ended',
      action: 'Resume',
    });
    await expect(group.getByTestId('session-item').filter({ hasText: ended.title })).toHaveCount(1);
  });

  test('ended session tab replays terminal history before resume', async ({ page }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-ended-replay-${stamp}`;
    const ended = await createSession(page, { workspaceId, title: `Ended Replay ${stamp}` });
    const draft = await createSession(page, { workspaceId, title: `Ended Replay Draft ${stamp}` });

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, ended.title);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await assertActiveDetail(page, { title: ended.title, status: 'running', action: 'Stop' });
    await expect.poll(() => terminalTextLength(page), { timeout: 10000 }).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await assertActiveDetail(page, { title: ended.title, status: 'ended', action: 'Resume' });

    await selectSessionTab(group, draft.title);
    await assertActiveDetail(page, { title: draft.title, status: 'draft', action: 'Start' });

    await selectSessionTab(group, ended.title);
    await assertActiveDetail(page, { title: ended.title, status: 'ended', action: 'Resume' });
    await expect(page.locator('.xterm')).toBeVisible();
    await expect(page.getByTestId('ended-terminal-transcript')).toHaveCount(0);
    await expect.poll(() => terminalText(page), { timeout: 10000 }).not.toHaveLength(0);
  });

  test('ending a live session does not append replayed history onto existing output', async ({
    page,
  }) => {
    test.skip(
      !MOCK_CLAUDE_PROVIDER_ENABLED,
      'Requires CUBBY_MOCK_CLAUDE_PROVIDER=1 for deterministic terminal output',
    );

    await page.addInitScript(() => {
      const replayWindow = window as typeof window & { __terminalReplayResponses?: number };
      replayWindow.__terminalReplayResponses = 0;
      const NativeWebSocket = window.WebSocket;

      window.WebSocket = class ReplayCountingWebSocket extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          this.addEventListener('message', (event: MessageEvent) => {
            try {
              const message = JSON.parse(String(event.data));
              if (
                message &&
                typeof message === 'object' &&
                typeof message.id === 'string' &&
                message.id.startsWith('replay-') &&
                message.ok === true
              ) {
                replayWindow.__terminalReplayResponses =
                  (replayWindow.__terminalReplayResponses ?? 0) + 1;
              }
            } catch {}
          });
        }
      };
    });

    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-ended-no-append-${stamp}`;
    const session = await createSession(page, {
      workspaceId,
      title: `Ended No Append ${stamp}`,
    });
    const marker = `Mock Claude Code ready for ${session.id.slice(0, 8)}`;

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, session.title);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await assertActiveDetail(page, { title: session.title, status: 'running', action: 'Stop' });
    await expect
      .poll(async () => countOccurrences(await terminalText(page), marker), { timeout: 10000 })
      .toBe(3);

    const liveReplayResponses = await page.evaluate(
      () =>
        (window as typeof window & { __terminalReplayResponses?: number })
          .__terminalReplayResponses ?? 0,
    );
    const liveMarkerCount = countOccurrences(await terminalText(page), marker);

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await assertActiveDetail(page, { title: session.title, status: 'ended', action: 'Resume' });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as typeof window & { __terminalReplayResponses?: number })
                .__terminalReplayResponses ?? 0,
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThan(liveReplayResponses);

    await expect(page.locator('.xterm')).toBeVisible();
    await expect(page.getByTestId('ended-terminal-transcript')).toHaveCount(0);
    expect(countOccurrences(await terminalText(page), marker)).toBe(liveMarkerCount);
  });

  test('ended replay opens at the latest terminal screen when history has scrollback', async ({
    page,
  }) => {
    test.skip(
      !MOCK_CLAUDE_PROVIDER_ENABLED,
      'Requires CUBBY_MOCK_CLAUDE_PROVIDER=1 for deterministic terminal output',
    );

    await page.addInitScript(() => {
      const socketWindow = window as typeof window & { __cubbyWs?: WebSocket };
      const NativeWebSocket = window.WebSocket;

      window.WebSocket = class CapturedWebSocket extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          socketWindow.__cubbyWs = this;
        }
      };
    });

    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-ended-scrollback-${stamp}`;
    const session = await createSession(page, {
      workspaceId,
      title: `Ended Scrollback ${stamp}`,
    });
    const lastLine = `scroll-bottom-${stamp}-79`;
    const scrollback = Array.from(
      { length: 80 },
      (_, index) => `scroll-bottom-${stamp}-${index}\r\n`,
    ).join('');

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, session.title);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await assertActiveDetail(page, { title: session.title, status: 'running', action: 'Stop' });
    await expect
      .poll(() => terminalText(page), { timeout: 10000 })
      .toContain('Mock Claude Code ready');

    await page.evaluate(
      ({ sessionId, data }) => {
        const socket = (window as typeof window & { __cubbyWs?: WebSocket }).__cubbyWs;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          throw new Error('WebSocket is not open');
        }
        socket.send(
          JSON.stringify({
            id: `scrollback-input-${Date.now()}`,
            cmd: 'terminal.input',
            args: { sessionId, data },
          }),
        );
      },
      { sessionId: session.id, data: scrollback },
    );
    await expect.poll(() => terminalText(page), { timeout: 10000 }).toContain(lastLine);

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await assertActiveDetail(page, { title: session.title, status: 'ended', action: 'Resume' });
    await expect(page.locator('.xterm')).toBeVisible();
    await expect.poll(() => terminalText(page), { timeout: 10000 }).toContain(lastLine);
  });

  test('resume starts from a clean live terminal after showing ended history', async ({ page }) => {
    test.skip(
      !MOCK_CLAUDE_PROVIDER_ENABLED,
      'Requires CUBBY_MOCK_CLAUDE_PROVIDER=1 for deterministic terminal output',
    );

    await page.addInitScript(() => {
      const commandWindow = window as typeof window & { __wsCommands?: unknown[] };
      commandWindow.__wsCommands = [];
      const NativeWebSocket = window.WebSocket;

      window.WebSocket = class CommandLoggingWebSocket extends NativeWebSocket {
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          try {
            commandWindow.__wsCommands?.push(JSON.parse(String(data)));
          } catch {}
          return super.send(data);
        }
      };
    });

    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-clean-resume-${stamp}`;
    const session = await createSession(page, { workspaceId, title: `Clean Resume ${stamp}` });

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await selectSessionTab(group, session.title);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await assertActiveDetail(page, { title: session.title, status: 'running', action: 'Stop' });
    await expect
      .poll(() => terminalText(page), { timeout: 10000 })
      .toContain('Mock Claude Code ready');

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await assertActiveDetail(page, { title: session.title, status: 'ended', action: 'Resume' });
    await expect(page.locator('.xterm')).toBeVisible();
    await expect(page.getByTestId('ended-terminal-transcript')).toHaveCount(0);
    await expect(terminalText(page)).resolves.toContain('Mock Claude Code ready');

    const commandsBeforeResume = await page.evaluate(
      () => (window as typeof window & { __wsCommands?: unknown[] }).__wsCommands?.length ?? 0,
    );

    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await assertActiveDetail(page, { title: session.title, status: 'running', action: 'Stop' });
    await expect(page.getByTestId('ended-terminal-transcript')).toHaveCount(0);
    await expect(page.locator('.xterm')).toBeVisible();
    await expect
      .poll(() => terminalText(page), { timeout: 10000 })
      .toContain('Mock Claude Code resumed');
    await expect
      .poll(() => terminalText(page), { timeout: 10000 })
      .not.toContain('Mock Claude Code ready');

    const resumeTerminalCommands = await page.evaluate(
      ({ startIndex, sessionId }) => {
        const commands =
          (
            window as typeof window & {
              __wsCommands?: Array<{ cmd?: string; args?: { sessionId?: string } }>;
            }
          ).__wsCommands ?? [];
        return commands
          .slice(startIndex)
          .filter(
            (command) =>
              command.args?.sessionId === sessionId && command.cmd?.startsWith('terminal.'),
          );
      },
      { startIndex: commandsBeforeResume, sessionId: session.id },
    );
    expect(
      resumeTerminalCommands.filter((command) => command.cmd === 'terminal.unsubscribe'),
    ).toEqual([]);
  });

  test('groups sessions by workspace and limits visible second-level tabs', async ({ page }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-group-${stamp}`;
    const hiddenTitle = `Grouped Session 1 ${stamp}`;

    for (let i = 1; i <= 7; i++) {
      await page.request.post('/api/sessions', {
        data: {
          workspaceId,
          provider: 'claude-code',
          title: `Grouped Session ${i} ${stamp}`,
        },
      });
    }

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await expect(group).toHaveCount(1);
    await expect(group.getByTestId('session-item')).toHaveCount(5);
    await expect(group.getByRole('button', { name: 'More 2' })).toBeVisible();

    await group.getByRole('button', { name: 'More 2' }).click();
    await page.getByTestId('session-more-item').filter({ hasText: hiddenTitle }).click();

    await assertActiveDetail(page, { title: hiddenTitle, status: 'draft', action: 'Start' });
    await expect(group.getByTestId('session-item').filter({ hasText: hiddenTitle })).toHaveCount(1);
    await expect(group.getByTestId('session-item')).toHaveCount(5);
  });

  test('workspace tabs can collapse and expand their session tabs', async ({ page }) => {
    const stamp = Date.now();
    const workspaceId = `/tmp/cubby-collapse-${stamp}`;
    const title = `Collapsible Session ${stamp}`;

    await page.request.post('/api/sessions', {
      data: { workspaceId, provider: 'claude-code', title },
    });

    await page.goto('/');

    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await expect(group.getByTestId('session-item').filter({ hasText: title })).toHaveCount(1);

    await group.getByTestId('workspace-toggle').click();
    await expect(group.getByTestId('session-item')).toHaveCount(0);

    await group.getByTestId('workspace-toggle').click();
    await expect(group.getByTestId('session-item').filter({ hasText: title })).toHaveCount(1);
  });

  test('workspace tab has an independent expand and collapse control', async ({ page }) => {
    const stamp = Date.now();
    const firstWorkspaceId = `/tmp/cubby-toggle-a-${stamp}`;
    const secondWorkspaceId = `/tmp/cubby-toggle-b-${stamp}`;
    const first = await createSession(page, {
      workspaceId: firstWorkspaceId,
      title: `Toggle A ${stamp}`,
    });
    const second = await createSession(page, {
      workspaceId: secondWorkspaceId,
      title: `Toggle B ${stamp}`,
    });

    await page.goto('/');
    await page
      .getByTestId('workspace-group')
      .filter({ hasText: secondWorkspaceId })
      .getByTestId('workspace-tab')
      .click();
    await assertActiveDetail(page, { title: second.title, status: 'draft', action: 'Start' });

    const firstGroup = page.getByTestId('workspace-group').filter({ hasText: firstWorkspaceId });
    const toggle = firstGroup.getByTestId('workspace-toggle');

    await expect(toggle).toHaveCSS('width', '28px');
    await expect(toggle).toHaveCSS('height', '28px');

    await toggle.click();
    await expect(firstGroup.getByTestId('session-item')).toHaveCount(0);
    await assertActiveDetail(page, { title: second.title, status: 'draft', action: 'Start' });

    await toggle.click();
    await expect(
      firstGroup.getByTestId('session-item').filter({ hasText: first.title }),
    ).toHaveCount(1);
    await assertActiveDetail(page, { title: second.title, status: 'draft', action: 'Start' });

    await firstGroup.getByTestId('workspace-tab').click();
    await assertActiveDetail(page, { title: first.title, status: 'draft', action: 'Start' });
  });

  test('session title is generated from the first terminal input', async ({ page }) => {
    const workspaceId = `/tmp/cubby-title-${Date.now()}`;
    const createRes = await page.request.post('/api/sessions', {
      data: { workspaceId, provider: 'claude-code', title: null },
    });
    expect(createRes.ok()).toBeTruthy();
    const session = (await createRes.json()) as SessionFixture;

    await page.goto('/');
    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceId });
    await group.getByTestId('session-item').filter({ hasText: 'claude-code' }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await assertActiveDetail(page, { title: 'claude-code', status: 'running', action: 'Stop' });
    await group.getByTestId('workspace-toggle').click();
    await expect(group.getByTestId('session-item')).toHaveCount(0);

    await page.locator('.xterm').click();
    await page.keyboard.type('Build pinyin tone cards');
    await page.keyboard.press('Enter');
    await assertActiveDetail(page, {
      title: 'Build pinyin tone cards',
      status: 'running',
      action: 'Stop',
    });
    await expect(group.getByTestId('session-item')).toHaveCount(0);

    await group.getByTestId('workspace-toggle').click();

    await expect(
      page
        .getByTestId('workspace-group')
        .filter({ hasText: session.workspaceId })
        .getByTestId('session-item')
        .filter({ hasText: 'Build pinyin tone cards' }),
    ).toHaveCount(1);
    await assertActiveDetail(page, {
      title: 'Build pinyin tone cards',
      status: 'running',
      action: 'Stop',
    });
    await expect(group.getByTestId('session-item').filter({ hasText: 'claude-code' })).toHaveCount(
      0,
    );
  });

  test('start a session and see terminal', async ({ page }) => {
    const title = `E2E Test ${Date.now()}`;
    // Create a session via API
    const response = await page.request.post('/api/sessions', {
      data: { workspaceId: '/tmp', provider: 'claude-code', title },
    });
    expect(response.ok()).toBeTruthy();

    await page.goto('/');

    // Click on the session
    await page.getByTestId('session-item').filter({ hasText: title }).click();

    // Click Start button
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    // Wait for status to change to running
    await assertActiveDetail(page, { title, status: 'running', action: 'Stop' });

    // Terminal should be visible (xterm.js renders a canvas)
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 5000 });
  });

  test('stop and resume an ended session', async ({ page }) => {
    const title = `Resume Test ${Date.now()}`;
    // Create and start a session via API
    const createRes = await page.request.post('/api/sessions', {
      data: { workspaceId: '/tmp', provider: 'claude-code', title },
    });
    expect(createRes.ok()).toBeTruthy();

    await page.goto('/');

    // Click on the session
    await page.getByTestId('session-item').filter({ hasText: title }).click();

    // Start the session
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    // Wait for running status
    await assertActiveDetail(page, { title, status: 'running', action: 'Stop' });

    // Stop the session
    await page.getByRole('button', { name: 'Stop', exact: true }).click();

    // Wait for ended status
    await assertActiveDetail(page, { title, status: 'ended', action: 'Resume' });

    // Resume the session
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await assertActiveDetail(page, { title, status: 'running', action: 'Stop' });
  });

  test('API healthcheck works', async ({ request }) => {
    const response = await request.get('/healthz');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  test('API sessions CRUD', async ({ request }) => {
    const title = `API Test ${Date.now()}`;
    // List sessions
    const listRes = await request.get('/api/sessions');
    expect(listRes.ok()).toBeTruthy();

    // Create session
    const createRes = await request.post('/api/sessions', {
      data: { workspaceId: '/tmp', provider: 'claude-code', title },
    });
    expect(createRes.ok()).toBeTruthy();
    const session = await createRes.json();
    expect(session.id).toBeTruthy();
    expect(session.status).toBe('draft');

    // Get session
    const getRes = await request.get(`/api/sessions/${session.id}`);
    expect(getRes.ok()).toBeTruthy();
    const fetched = await getRes.json();
    expect(fetched.id).toBe(session.id);
    expect(fetched.title).toBe(title);
  });
});
