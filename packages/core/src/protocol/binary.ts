import { BinaryFrameType } from '../types/ws.js';

export interface DecodedFrame {
  type: BinaryFrameType;
  terminalId: string;
  payload: string;
}

export function encodeBinaryFrame(type: BinaryFrameType, terminalId: string, payload: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const idBytes = encoder.encode(terminalId);
  const payloadBytes = encoder.encode(payload);
  // 1 byte type + 4 bytes id length + id bytes + 4 bytes payload length + payload bytes
  const buffer = new ArrayBuffer(1 + 4 + idBytes.length + 4 + payloadBytes.length);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  view.setUint8(0, type);
  view.setUint32(1, idBytes.length);
  uint8.set(idBytes, 5);
  view.setUint32(5 + idBytes.length, payloadBytes.length);
  uint8.set(payloadBytes, 9 + idBytes.length);

  return buffer;
}

export function decodeBinaryFrame(buffer: ArrayBuffer): DecodedFrame {
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);
  const decoder = new TextDecoder();

  const type = view.getUint8(0) as BinaryFrameType;
  const idLen = view.getUint32(1);
  const terminalId = decoder.decode(uint8.slice(5, 5 + idLen));
  const payloadLen = view.getUint32(5 + idLen);
  const payload = decoder.decode(uint8.slice(9 + idLen, 9 + idLen + payloadLen));

  return { type, terminalId, payload };
}
