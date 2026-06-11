import { describe, expect, it } from 'vitest';
import { AUTH_COOKIE_NAME, buildAuthCookie } from './service.js';

describe('auth cookies', () => {
  it('uses a session cookie by default', () => {
    const cookie = buildAuthCookie('token-value');

    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=token-value`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Max-Age=');
    expect(cookie).not.toContain('Expires=');
  });
});
