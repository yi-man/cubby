import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../db/index.js';

export const AUTH_COOKIE_NAME = 'cubby_auth';

const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_SESSION_TTL_SECONDS = AUTH_SESSION_TTL_MS / 1000;
const LOGIN_BLOCK_THRESHOLD = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

interface AuthSessionRow {
  token_hash: string;
  expires_at: number;
}

interface AuthLoginBlockRow {
  ip: string;
  failed_count: number;
  blocked_until: number | null;
}

export interface AuthConfig {
  password?: string;
  passwordHash?: string;
  allowedOrigins?: string[];
}

export interface LoginResult {
  status: 'ok' | 'invalid' | 'blocked' | 'disabled';
  token?: string;
}

export class AuthService {
  private readonly passwordHash: string | null;
  private readonly allowedOrigins: Set<string>;

  constructor(
    private db: Database,
    config: AuthConfig,
  ) {
    const password = config.password?.trim();
    const passwordHash = config.passwordHash?.trim();
    this.passwordHash = passwordHash || (password ? bcrypt.hashSync(password, 10) : null);
    this.allowedOrigins = new Set((config.allowedOrigins ?? []).filter(Boolean));
  }

  get enabled(): boolean {
    return this.passwordHash !== null;
  }

  async login(password: string, ip: string, now = Date.now()): Promise<LoginResult> {
    if (!this.enabled || !this.passwordHash) return { status: 'disabled' };
    if (this.isLoginBlocked(ip, now)) return { status: 'blocked' };

    const valid = await bcrypt.compare(password, this.passwordHash);
    if (!valid) {
      this.recordFailedLogin(ip, now);
      return { status: 'invalid' };
    }

    this.clearLoginBlock(ip);
    const token = randomBytes(32).toString('base64url');
    this.storeSessionToken(token, now);
    return { status: 'ok', token };
  }

  isRequestAuthenticated(request: FastifyRequest, now = Date.now()): boolean {
    if (!this.enabled) return true;
    const token = parseCookieHeader(request.headers.cookie)[AUTH_COOKIE_NAME];
    if (!token) return false;
    return this.isTokenValid(token, now);
  }

  logout(request: FastifyRequest): void {
    const token = parseCookieHeader(request.headers.cookie)[AUTH_COOKIE_NAME];
    if (!token) return;
    this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
  }

  isOriginAllowed(request: FastifyRequest): boolean {
    const origin = request.headers.origin;
    if (!origin) return true;
    if (this.allowedOrigins.size > 0) return this.allowedOrigins.has(origin);

    try {
      const originUrl = new URL(origin);
      return originUrl.host === request.headers.host;
    } catch {
      return false;
    }
  }

  private storeSessionToken(token: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO auth_sessions (token_hash, created_at, expires_at)
         VALUES (?, ?, ?)`,
      )
      .run(hashToken(token), now, now + AUTH_SESSION_TTL_MS);
  }

  private isTokenValid(token: string, now: number): boolean {
    const row = this.db
      .prepare('SELECT token_hash, expires_at FROM auth_sessions WHERE token_hash = ?')
      .get(hashToken(token)) as AuthSessionRow | undefined;
    if (!row) return false;
    if (row.expires_at <= now) {
      this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(row.token_hash);
      return false;
    }
    return true;
  }

  private isLoginBlocked(ip: string, now: number): boolean {
    const row = this.getLoginBlock(ip);
    if (!row?.blocked_until) return false;
    if (row.blocked_until > now) return true;
    this.clearLoginBlock(ip);
    return false;
  }

  private recordFailedLogin(ip: string, now: number): void {
    const existing = this.getLoginBlock(ip);
    const failedCount = (existing?.failed_count ?? 0) + 1;
    const blockedUntil = failedCount >= LOGIN_BLOCK_THRESHOLD ? now + LOGIN_BLOCK_MS : null;
    this.db
      .prepare(
        `INSERT INTO auth_login_blocks (ip, failed_count, blocked_until)
         VALUES (?, ?, ?)
         ON CONFLICT(ip) DO UPDATE SET
           failed_count = excluded.failed_count,
           blocked_until = excluded.blocked_until`,
      )
      .run(ip, failedCount, blockedUntil);
  }

  private clearLoginBlock(ip: string): void {
    this.db.prepare('DELETE FROM auth_login_blocks WHERE ip = ?').run(ip);
  }

  private getLoginBlock(ip: string): AuthLoginBlockRow | null {
    const row = this.db
      .prepare('SELECT ip, failed_count, blocked_until FROM auth_login_blocks WHERE ip = ?')
      .get(ip) as AuthLoginBlockRow | undefined;
    return row ?? null;
  }
}

export function buildAuthCookie(token: string): string {
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_SESSION_TTL_SECONDS}`;
}

export function clearAuthCookie(): string {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function authConfigFromEnv(env: NodeJS.ProcessEnv): AuthConfig {
  return {
    password: env.CUBBY_AUTH_PASSWORD,
    passwordHash: env.CUBBY_AUTH_PASSWORD_HASH,
    allowedOrigins: env.CUBBY_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()),
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}
