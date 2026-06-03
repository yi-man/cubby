import type { WSEvent, WSRequest, WSResponse } from '@cubby/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export function serializeWSRequest(req: WSRequest): string {
  return JSON.stringify(req);
}

export function parseWSMessage(raw: string): WSResponse | WSEvent {
  return JSON.parse(raw);
}

type MessageHandler = (msg: WSResponse | WSEvent) => void;

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(new Set<MessageHandler>());
  const pendingRef = useRef(
    new Map<string, { resolve: (v: WSResponse) => void; timer: ReturnType<typeof setTimeout> }>(),
  );
  const [connected, setConnected] = useState(false);

  const send = useCallback((req: WSRequest) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(serializeWSRequest(req));
    }
  }, []);

  const request = useCallback(
    (req: WSRequest, timeoutMs = 10000): Promise<WSResponse> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRef.current.delete(req.id);
          reject(new Error(`Request ${req.id} timed out`));
        }, timeoutMs);
        pendingRef.current.set(req.id, { resolve, timer });
        send(req);
      });
    },
    [send],
  );

  const onMessage = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  // WebSocket lifecycle — only create once per url
  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const msg = parseWSMessage(e.data);
      // Match pending requests by id
      if ('ok' in msg && 'id' in msg) {
        const pending = pendingRef.current.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRef.current.delete(msg.id);
          pending.resolve(msg);
          return;
        }
      }
      for (const handler of handlersRef.current) {
        handler(msg);
      }
    };

    return () => {
      for (const [, pending] of pendingRef.current) {
        clearTimeout(pending.timer);
      }
      pendingRef.current.clear();
      ws.close();
    };
  }, [url]);

  return { send, request, onMessage, connected };
}
