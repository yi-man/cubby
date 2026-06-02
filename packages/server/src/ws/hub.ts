import type { WebSocket } from 'ws';
import type { WSEvent } from '@cubby/core';

export class WebSocketHub {
  private topicClients = new Map<string, Set<WebSocket>>();
  private clientTopics = new Map<WebSocket, Set<string>>();

  subscribe(ws: WebSocket, topic: string): void {
    if (!this.topicClients.has(topic)) {
      this.topicClients.set(topic, new Set());
    }
    this.topicClients.get(topic)!.add(ws);

    if (!this.clientTopics.has(ws)) {
      this.clientTopics.set(ws, new Set());
    }
    this.clientTopics.get(ws)!.add(topic);
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
      if (ws.readyState === 1) {
        ws.send(msg);
      }
    }
  }

  removeClient(ws: WebSocket): void {
    const topics = this.clientTopics.get(ws);
    if (topics) {
      for (const topic of topics) {
        this.topicClients.get(topic)?.delete(ws);
      }
      this.clientTopics.delete(ws);
    }
  }
}
