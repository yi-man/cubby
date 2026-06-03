import { expect, type Page, test } from '@playwright/test';

const REAL_CLAUDE_ENABLED = process.env.CUBBY_SKIP_REAL_CLAUDE_E2E !== '1';
const WORKSPACE =
  process.env.CUBBY_REAL_CLAUDE_WORKSPACE ?? '/Users/xxwade/code/my/pinyin-learning';

test.skip(!REAL_CLAUDE_ENABLED, 'Unset CUBBY_SKIP_REAL_CLAUDE_E2E to run real Claude Code E2E');

test.describe.configure({ mode: 'serial', retries: 0 });

async function createSessionFromUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ New Session' }).click();
  await page.getByLabel('Workspace path').fill(WORKSPACE);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(
    page.getByTestId('session-detail-pane').getByText(WORKSPACE, { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('session-detail-pane').getByTestId('session-status')).toHaveText(
    'running',
    { timeout: 20_000 },
  );
  await expect(page.locator('.xterm')).toBeVisible({ timeout: 20_000 });
  await waitForTerminalText(page, 'Claude Code', 20_000);
  await waitForTerminalIdle(page);
}

async function terminalText(page: Page): Promise<string> {
  return page.locator('.xterm-rows').evaluate((element) => element.textContent ?? '');
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

async function waitForTerminalText(
  page: Page,
  expected: string | RegExp,
  timeout = 60_000,
): Promise<void> {
  const assertion = expect.poll(() => terminalText(page), { timeout });
  if (typeof expected === 'string') {
    await assertion.toContain(expected);
  } else {
    await assertion.toMatch(expected);
  }
}

async function waitForTerminalIdle(page: Page, quietMs = 1_500, timeout = 30_000): Promise<void> {
  const start = Date.now();
  let lastText = await terminalText(page);
  let lastChangeAt = Date.now();

  while (Date.now() - start < timeout) {
    await page.waitForTimeout(250);
    const currentText = await terminalText(page);
    if (currentText !== lastText) {
      lastText = currentText;
      lastChangeAt = Date.now();
      continue;
    }
    if (Date.now() - lastChangeAt >= quietMs) return;
  }

  throw new Error('Terminal did not become idle before timeout');
}

function generatedTitleForToken(token: string): string {
  return `Reply exactly ${token}.`;
}

async function sendPromptAndWaitForAssistant(page: Page, token: string): Promise<string> {
  await page.locator('.xterm').click();
  await page.keyboard.type(`Reply exactly ${token}. Do not use tools.`);
  await page.keyboard.press('Enter');
  await waitForTerminalText(page, token, 30_000);
  await waitForTerminalIdle(page, 2_000, 120_000);
  return generatedTitleForToken(token);
}

async function chooseThemeAndAssertMenuClears(page: Page): Promise<void> {
  await page.locator('.xterm').click();
  await page.keyboard.type('/theme');
  await page.keyboard.press('Enter');
  await waitForTerminalText(page, 'Enter to select', 30_000);
  await expect
    .poll(async () => countOccurrences(await terminalText(page), 'Enter to select'), {
      timeout: 10_000,
    })
    .toBe(1);
  await page.keyboard.press('Enter');
  await waitForTerminalText(page, /Theme set to/i, 30_000);
  await waitForTerminalIdle(page);
  await expect.poll(() => terminalText(page), { timeout: 10_000 }).not.toContain('Enter to select');
  await expect.poll(() => terminalText(page), { timeout: 10_000 }).not.toContain('function greet');
}

async function navigateThemeMenuAndAssertSingleMenu(page: Page): Promise<void> {
  await page.locator('.xterm').click();
  await page.keyboard.type('/theme');
  await page.keyboard.press('Enter');
  await waitForTerminalText(page, 'Enter to select', 30_000);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(250);

  await expect
    .poll(async () => countOccurrences(await terminalText(page), 'Enter to select'), {
      timeout: 10_000,
    })
    .toBe(1);
  await expect
    .poll(async () => countOccurrences(await terminalText(page), 'Auto (match terminal)'), {
      timeout: 10_000,
    })
    .toBe(1);

  await page.keyboard.press('Enter');
  await waitForTerminalText(page, /Theme set to/i, 30_000);
  await waitForTerminalIdle(page);
  await expect.poll(() => terminalText(page), { timeout: 10_000 }).not.toContain('Enter to select');
  await expect.poll(() => terminalText(page), { timeout: 10_000 }).not.toContain('function greet');
}

async function selectWorkspaceSession(page: Page, title: string): Promise<void> {
  const workspaceGroup = page.getByTestId('workspace-group').filter({ hasText: WORKSPACE });
  await workspaceGroup.getByTestId('session-item').filter({ hasText: title }).click();
}

async function ctrlCExit(page: Page): Promise<void> {
  await page.locator('.xterm').click();
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+C');
  await expect(page.getByTestId('session-detail-pane').getByTestId('session-status')).toHaveText(
    'ended',
    { timeout: 20_000 },
  );
  await expect(
    page.getByTestId('session-detail-pane').getByRole('button', { name: 'Resume' }),
  ).toBeVisible();
  await waitForTerminalText(page, 'Resume this session with:', 20_000);
}

async function createTitledSession(page: Page, title: string): Promise<void> {
  const response = await page.request.post('/api/sessions', {
    data: { workspaceId: WORKSPACE, provider: 'claude-code', title },
  });
  expect(response.ok()).toBeTruthy();
}

test('real Claude Code session supports keyboard input, ctrl-c exit, resume, and tab switching', async ({
  page,
}) => {
  test.setTimeout(300_000);

  await page.goto('/');
  await expect(page.getByText('Select or create a session')).toBeVisible();

  await createSessionFromUi(page);
  await expect(
    page.getByTestId('workspace-group').filter({ hasText: WORKSPACE }).getByTestId('session-item'),
  ).toContainText('claude-code');
  const resumedTitle = await sendPromptAndWaitForAssistant(page, 'CUBBY_REAL_READY');
  await expect(
    page.getByTestId('workspace-group').filter({ hasText: WORKSPACE }).getByTestId('session-item'),
  ).toContainText(resumedTitle);
  await chooseThemeAndAssertMenuClears(page);

  await ctrlCExit(page);

  await expect(terminalText(page)).resolves.toContain('Resume this session with:');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByTestId('session-detail-pane').getByTestId('session-status')).toHaveText(
    'running',
    { timeout: 20_000 },
  );
  await waitForTerminalText(page, 'Claude Code', 30_000);
  await expect
    .poll(() => terminalText(page), { timeout: 20_000 })
    .not.toContain('Resume this session with:');
  await waitForTerminalIdle(page);
  await chooseThemeAndAssertMenuClears(page);
  await sendPromptAndWaitForAssistant(page, 'CUBBY_REAL_RESUMED');

  await createSessionFromUi(page);
  const workspaceGroup = page.getByTestId('workspace-group').filter({ hasText: WORKSPACE });
  await expect(workspaceGroup.getByTestId('session-item')).toHaveCount(2);

  await selectWorkspaceSession(page, resumedTitle);
  await waitForTerminalText(page, 'CUBBY_REAL_RESUMED', 20_000);
  await sendPromptAndWaitForAssistant(page, 'CUBBY_REAL_AFTER_SWITCH');

  await selectWorkspaceSession(page, 'claude-code');
  await expect(page.getByTestId('session-detail-pane').getByTestId('session-status')).toHaveText(
    'running',
    { timeout: 20_000 },
  );
  await waitForTerminalText(page, 'Claude Code', 20_000);
  await sendPromptAndWaitForAssistant(page, 'CUBBY_REAL_SECOND_TAB');
});

test('real slash-command titled session shows a single theme menu after resume', async ({
  page,
}) => {
  test.setTimeout(240_000);

  const title = `/theme-${Date.now()}`;
  await createTitledSession(page, title);

  await page.goto('/');
  await selectWorkspaceSession(page, title);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('session-detail-pane').getByTestId('session-status')).toHaveText(
    'running',
    { timeout: 20_000 },
  );
  await waitForTerminalText(page, 'Claude Code', 20_000);
  await waitForTerminalIdle(page);
  await navigateThemeMenuAndAssertSingleMenu(page);

  await ctrlCExit(page);
  await expect(terminalText(page)).resolves.toContain('Theme set to');

  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByTestId('session-detail-pane').getByTestId('session-status')).toHaveText(
    'running',
    { timeout: 20_000 },
  );
  await expect.poll(() => terminalText(page), { timeout: 20_000 }).not.toContain('Theme set to');
  await waitForTerminalIdle(page);
  await navigateThemeMenuAndAssertSingleMenu(page);
});
