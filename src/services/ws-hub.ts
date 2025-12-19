/**
 * WebSocket hub for real-time features
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import { config } from '../config/env.js';

const WS_PORT = Number(process.env.WS_PORT || process.env.WEBSOCKET_PORT || 4001);

const sessions = new Map<string, Set<WebSocket>>();
let wss: WebSocketServer | null = null;
let started = false;

function addClient(sessionId: string, ws: WebSocket) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
  sessions.get(sessionId)!.add(ws);
}

function removeClient(ws: WebSocket) {
  for (const [, set] of sessions) {
    if (set.has(ws)) {
      set.delete(ws);
    }
  }
}

export function broadcastSessionRefresh(sessionId: string | number) {
  const set = sessions.get(String(sessionId));
  if (!set) return;
  const payload = JSON.stringify({ type: 'session:refresh', sessionId: String(sessionId) });
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

export function setupWebSocket(httpServer: HTTPServer) {
  if (started) return { wss, port: WS_PORT };
  started = true;
  
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg?.type === 'subscribe' && msg.sessionId) {
          addClient(String(msg.sessionId), ws);
          ws.send(JSON.stringify({ type: 'session:subscribed', sessionId: msg.sessionId }));
        }
      } catch (e) {
        // ignore bad messages
      }
    });

    ws.on('close', () => removeClient(ws));
    ws.on('error', () => removeClient(ws));
  });

  console.info(`[ws] WebSocket server attached to HTTP server`);
  return { wss, port: WS_PORT };
}

