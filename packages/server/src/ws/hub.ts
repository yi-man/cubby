import type { WSEvent } from '@cubby/core';
import type { WebSocket } from 'ws';

export class WebSocketHub {
  private topicClients = new Map<string, Set<WebSocket>>();
  private clientTopics = new Map<WebSocket, Set<string>>();

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
