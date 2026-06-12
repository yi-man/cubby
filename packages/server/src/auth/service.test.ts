import { describe, expect, it } from 'vitest';
import { AUTH_COOKIE_NAME, buildAuthCookie } from './service.js';

describe('auth cookies', () => {
  it('persists the login cookie for the server session TTL', () => {
    const cookie = buildAuthCookie('token-value');

    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=token-value`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).not.toContain('Expires=');
  });
});
