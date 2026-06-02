export interface StructuredError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function createError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): StructuredError {
  return { code, message, details };
}
