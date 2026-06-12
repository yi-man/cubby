export interface PreviewPort {
  id: string;
  port: number;
  pid: number;
  command: string;
  cwd: string;
  host: string;
  url: string;
  lastActivityAt: string;
}

export interface PreviewListResponse {
  root: string;
  ports: PreviewPort[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPreviewPort(value: unknown): value is PreviewPort {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.port === 'number' &&
    typeof value.pid === 'number' &&
    typeof value.command === 'string' &&
    typeof value.cwd === 'string' &&
    typeof value.host === 'string' &&
    typeof value.url === 'string' &&
    typeof value.lastActivityAt === 'string'
  );
}

export function isPreviewListResponse(value: unknown): value is PreviewListResponse {
  return (
    isRecord(value) &&
    typeof value.root === 'string' &&
    Array.isArray(value.ports) &&
    value.ports.every(isPreviewPort)
  );
}

export function previewButtonLabel(ports: Array<unknown> | null | undefined): string {
  const count = ports?.length ?? 0;
  if (count === 0) return 'Previews';
  return `${count} ${count === 1 ? 'preview' : 'previews'}`;
}

export function formatPreviewLastActivity(lastActivityAt: string, now = Date.now()): string {
  const timestamp = Date.parse(lastActivityAt);
  if (!Number.isFinite(timestamp)) return 'Activity unknown';

  const elapsedMs = Math.max(0, now - timestamp);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds < 60) return 'just now';

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

export function previewAbsoluteUrl(path: string, origin: string): string {
  const port = previewPortFromPath(path);
  const originUrl = new URL(origin);
  if (port !== null && isLocalPreviewHost(originUrl.hostname)) {
    originUrl.port = String(port);
    originUrl.pathname = '/';
    originUrl.search = '';
    originUrl.hash = '';
    return originUrl.href;
  }
  return new URL(path, origin).href;
}

function previewPortFromPath(path: string): number | null {
  const match = path.match(/^\/preview\/(\d{1,5})(?:\/|$)/);
  if (!match) return null;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return port;
}

function isLocalPreviewHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
