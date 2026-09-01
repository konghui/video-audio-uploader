import type { WebSocket } from 'ws';
import type { ProgressEvent } from '../core/types';

export class Broadcaster {
  private clients = new Set<WebSocket>();
  add(ws: WebSocket) {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }
  send(e: ProgressEvent) {
    const data = JSON.stringify(e);
    for (const ws of this.clients) { try { ws.send(data); } catch { /* ignore */ } }
  }
}
