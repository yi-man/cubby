import type { WSEvent } from '@cubby/core';
import type { WebSocket } from 'ws';

interface ClientKeepAliveState {
  awaitingPong: boolean;
  lastPingAt: number;
}

interface KeepAliveOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

const OPEN_READY_STATE = 1;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 30_000;
const DEFAULT_KEEPALIVE_TIMEOUT_MS = 10_000;

export class WebSocketHub {
  private topicClients = new Map<string, Set<WebSocket>>();
  private clientTopics = new Map<WebSocket, Set<string>>();
  private allClients = new Set<WebSocket>();
  private clientKeepAlive = new Map<WebSocket, ClientKeepAliveState>();

  addClient(ws: WebSocket): void {
    this.allClients.add(ws);
    this.clientKeepAlive.set(ws, { awaitingPong: false, lastPingAt: 0 });
    ws.on('pong', () => {
      const state = this.clientKeepAlive.get(ws);
      if (!state) return;
      state.awaitingPong = false;
    });
  }

  subscribe(ws: WebSocket, topic: string): void {
    let topicSet = this.topicClients.get(topic);
    if (!topicSet) {
      topicSet = new Set();
      this.topicClients.set(topic, topicSet);
    }
    topicSet.add(ws);

    let clientSet = this.clientTopics.get(ws);
    if (!clientSet) {
      clientSet = new Set();
      this.clientTopics.set(ws, clientSet);
    }
    clientSet.add(topic);
  }

  unsubscribe(ws: WebSocket, topic: string): void {
    this.topicClients.get(topic)?.delete(ws);
    this.clientTopics.get(ws)?.delete(topic);
  }

  broadcast(topic: string, event: WSEvent): void {
    const clients = this.topicClients.get(topic);
    if (!clients) return;
    const msg = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === OPEN_READY_STATE) {
        ws.send(msg);
      }
    }
  }

  broadcastToAll(event: WSEvent): void {
    const msg = JSON.stringify(event);
    for (const ws of this.allClients) {
      if (ws.readyState === OPEN_READY_STATE) {
        ws.send(msg);
      }
    }
  }

  startKeepAlive(options: KeepAliveOptions = {}): () => void {
    const intervalMs = options.intervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_KEEPALIVE_TIMEOUT_MS;
    const interval = setInterval(() => {
      this.pingClients(Date.now(), { timeoutMs });
    }, intervalMs);

    return () => clearInterval(interval);
  }

  pingClients(now = Date.now(), options: Pick<KeepAliveOptions, 'timeoutMs'> = {}): void {
    const timeoutMs = options.timeoutMs ?? DEFAULT_KEEPALIVE_TIMEOUT_MS;

    for (const ws of this.allClients) {
      if (ws.readyState !== OPEN_READY_STATE) continue;
      const state = this.clientKeepAlive.get(ws) ?? { awaitingPong: false, lastPingAt: 0 };
      this.clientKeepAlive.set(ws, state);

      if (state.awaitingPong && now - state.lastPingAt >= timeoutMs) {
        ws.terminate();
        this.removeClient(ws);
        continue;
      }

      state.awaitingPong = true;
      state.lastPingAt = now;
      ws.ping();
    }
  }

  closeAll(): void {
    for (const ws of Array.from(this.allClients)) {
      try {
        ws.terminate();
      } finally {
        this.removeClient(ws);
      }
    }
  }

  removeClient(ws: WebSocket): void {
    this.allClients.delete(ws);
    this.clientKeepAlive.delete(ws);
    const topics = this.clientTopics.get(ws);
    if (topics) {
      for (const topic of topics) {
        this.topicClients.get(topic)?.delete(ws);
      }
      this.clientTopics.delete(ws);
    }
  }
}
