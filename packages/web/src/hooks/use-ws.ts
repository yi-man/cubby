import { WS_COMMANDS, type WSEvent, type WSRequest, type WSResponse } from '@cubby/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export const WS_RECONNECT_BASE_DELAY_MS = 250;
export const WS_RECONNECT_MAX_DELAY_MS = 5000;

export interface TerminalSubscription {
  sessionId: string;
}

export function serializeWSRequest(req: WSRequest): string {
  return JSON.stringify(req);
}

export function parseWSMessage(raw: string): WSResponse | WSEvent {
  return JSON.parse(raw);
}

type MessageHandler = (msg: WSResponse | WSEvent) => void;

export function reconnectDelayMs(attempt: number): number {
  const normalizedAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(WS_RECONNECT_MAX_DELAY_MS, WS_RECONNECT_BASE_DELAY_MS * 2 ** normalizedAttempt);
}

export function rememberTerminalSubscription(
  subscriptions: Map<string, TerminalSubscription>,
  req: WSRequest,
): void {
  const sessionId = terminalSubscriptionSessionId(req);
  if (!sessionId) return;

  if (req.cmd === WS_COMMANDS.TERMINAL_SUBSCRIBE) {
    subscriptions.set(sessionId, { sessionId });
    return;
  }

  if (req.cmd === WS_COMMANDS.TERMINAL_UNSUBSCRIBE) {
    subscriptions.delete(sessionId);
  }
}

export function buildResubscribeRequests(
  subscriptions: Map<string, TerminalSubscription>,
  now = Date.now,
): WSRequest[] {
  return Array.from(subscriptions.values()).map((subscription) => ({
    id: `resub-${subscription.sessionId}-${now()}`,
    cmd: WS_COMMANDS.TERMINAL_SUBSCRIBE,
    args: { sessionId: subscription.sessionId },
  }));
}

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const handlersRef = useRef(new Set<MessageHandler>());
  const subscriptionsRef = useRef(new Map<string, TerminalSubscription>());
  const pendingRef = useRef(
    new Map<
      string,
      {
        resolve: (v: WSResponse) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
        cmd: string;
      }
    >(),
  );
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const send = useCallback((req: WSRequest) => {
    rememberTerminalSubscription(subscriptionsRef.current, req);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(serializeWSRequest(req));
    }
  }, []);

  const request = useCallback(
    (req: WSRequest, timeoutMs = 10000): Promise<WSResponse> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRef.current.delete(req.id);
          const message = `Request ${req.id} (${req.cmd}) timed out`;
          setConnectionError(message);
          reject(new Error(message));
        }, timeoutMs);
        pendingRef.current.set(req.id, { resolve, reject, timer, cmd: req.cmd });
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

  // WebSocket lifecycle with reconnect and subscription replay.
  useEffect(() => {
    let disposed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current === null) return;
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      clearReconnectTimer();
      const delay = reconnectDelayMs(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      setReconnecting(true);
      reconnectTimerRef.current = window.setTimeout(connect, delay);
    };

    const handleMessage = (raw: string) => {
      const msg = parseWSMessage(raw);
      // Match pending requests by id
      if ('ok' in msg && 'id' in msg) {
        const pending = pendingRef.current.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRef.current.delete(msg.id);
          setConnectionError(null);
          pending.resolve(msg);
          return;
        }
      }
      for (const handler of handlersRef.current) {
        handler(msg);
      }
    };

    function connect() {
      if (disposed) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed || wsRef.current !== ws) return;
        reconnectAttemptRef.current = 0;
        setConnected(true);
        setReconnecting(false);
        setConnectionError(null);
        for (const req of buildResubscribeRequests(subscriptionsRef.current)) {
          ws.send(serializeWSRequest(req));
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        if (!disposed) scheduleReconnect();
      };

      ws.onerror = () => {
        if (!disposed) setConnectionError('WebSocket connection error');
      };

      ws.onmessage = (event) => handleMessage(String(event.data));
    }

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      for (const [, pending] of pendingRef.current) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Request ${pending.cmd} cancelled`));
      }
      pendingRef.current.clear();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [url]);

  return { send, request, onMessage, connected, reconnecting, connectionError };
}

function terminalSubscriptionSessionId(req: WSRequest): string | null {
  if (req.cmd !== WS_COMMANDS.TERMINAL_SUBSCRIBE && req.cmd !== WS_COMMANDS.TERMINAL_UNSUBSCRIBE) {
    return null;
  }
  const sessionId = req.args?.sessionId;
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId : null;
}
