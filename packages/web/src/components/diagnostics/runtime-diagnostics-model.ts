export type DiagnosticStatus = 'ok' | 'warning' | 'error';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  recommendation?: string;
}

export interface RuntimeDiagnosticsResponse {
  generatedAt: string;
  server: {
    host: string;
    port: number;
    dataDir: string;
    configPath: string;
  };
  checks: DiagnosticCheck[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDiagnosticStatus(value: unknown): value is DiagnosticStatus {
  return value === 'ok' || value === 'warning' || value === 'error';
}

function isDiagnosticCheck(value: unknown): value is DiagnosticCheck {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    isDiagnosticStatus(value.status) &&
    typeof value.detail === 'string' &&
    (typeof value.recommendation === 'string' || value.recommendation === undefined)
  );
}

export function isRuntimeDiagnosticsResponse(value: unknown): value is RuntimeDiagnosticsResponse {
  return (
    isRecord(value) &&
    typeof value.generatedAt === 'string' &&
    isRecord(value.server) &&
    typeof value.server.host === 'string' &&
    typeof value.server.port === 'number' &&
    typeof value.server.dataDir === 'string' &&
    typeof value.server.configPath === 'string' &&
    Array.isArray(value.checks) &&
    value.checks.every(isDiagnosticCheck)
  );
}

export function diagnosticStatusLabel(status: DiagnosticStatus): string {
  if (status === 'ok') return 'OK';
  if (status === 'warning') return 'Warning';
  return 'Error';
}
