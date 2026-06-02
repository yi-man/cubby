export interface WSRequest {
  id: string;
  cmd: string;
  args?: Record<string, unknown>;
}

export interface WSResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface WSEvent {
  evt: string;
  data: unknown;
}

export type WSMessage = WSRequest | WSResponse | WSEvent;

export enum BinaryFrameType {
  OUTPUT = 0x01,
  INPUT = 0x02,
  RESIZE = 0x03,
}
