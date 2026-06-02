import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSRequest, WSResponse, WSEvent } from '@cubby/core';

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
  const [connected, setConnected] = useState(false);

  const send = useCallback((req: WSRequest) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(serializeWSRequest(req));
    }
  }, []);

  const onMessage = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const msg = parseWSMessage(e.data);
      for (const handler of handlersRef.current) {
        handler(msg);
      }
    };

    return () => { ws.close(); };
  }, [url]);

  return { send, onMessage, connected };
}
