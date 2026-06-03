import { expect, type Locator, type Page, test } from '@playwright/test';

interface SessionFixture {
  id: string;
  title: string;
  workspaceId: string;
  status: string;
}

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
    await expect(page.locator('text=+ New Session')).toBeVisible();
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
    await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible();

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(sidebar).toHaveCSS('width', '0px');
    await expect(page.getByRole('button', { name: '+ New Session' })).toHaveCount(0);
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
    await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible();

    await page.reload();
    await expect(sidebar).toHaveCSS('width', '240px');
    await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible();
  });

  test('sidebar is collapsed by default on mobile without stored browser state', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const sidebar = page.getByTestId('sidebar-shell');
    await expect(sidebar).toHaveCSS('width', '0px');
    await expect(page.getByRole('button', { name: '+ New Session' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(sidebar).toHaveCSS('width', '240px');
    await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible();
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

  test('new session button opens workspace picker', async ({ page }) => {
    await page.goto('/');

    await page.getByText('+ New Session').click();

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
    ).toHaveCSS('border-color', 'rgb(137, 180, 250)');
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
    await expect.poll(() => terminalTextLength(page), { timeout: 10000 }).toBeGreaterThan(0);
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

  test('workspace tab has a large independent expand and collapse control', async ({ page }) => {
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

    await expect(toggle).toHaveCSS('width', '34px');
    await expect(toggle).toHaveCSS('height', '34px');

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
