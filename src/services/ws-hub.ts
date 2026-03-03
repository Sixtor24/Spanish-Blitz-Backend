/**
 * WebSocket Hub for real-time features
 * Handles play sessions and speech streaming
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import { config } from '../config/env.js';
import { startSpeechStream, sendAudioChunk, stopSpeechStream, getActiveSessionsCount } from './speech-stream.js';

const sessions = new Map<string, Set<WebSocket>>();
let wss: WebSocketServer | null = null;
let started = false;

/**
 * Add client to session
 */
function addClient(sessionId: string, ws: WebSocket) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new Set());
  }
  sessions.get(sessionId)!.add(ws);
}

/**
 * Remove client from all sessions
 */
function removeClient(ws: WebSocket) {
  for (const [sessionId, set] of sessions) {
    if (set.has(ws)) {
      set.delete(ws);
      // Clean up empty sessions
      if (set.size === 0) {
        sessions.delete(sessionId);
      }
    }
  }
}

/**
 * Broadcast message to all clients in a session
 */
export function broadcastSessionRefresh(sessionId: string | number) {
  const set = sessions.get(String(sessionId));
  if (!set) return;
  
  const payload = JSON.stringify({ 
    type: 'session:refresh', 
    sessionId: String(sessionId) 
  });
  
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Setup WebSocket server
 */
export function setupWebSocket(httpServer: HTTPServer) {
  if (started) return { wss, port: null };
  started = true;
  
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    // Connection established (log reduced)
    
    // Track which speech session this WebSocket client is using
    // so binary audio frames can be routed without JSON overhead
    let activeSpeechSessionId: string | null = null;

    ws.on('message', (data, isBinary) => {
      try {
        // Binary frame = raw audio chunk (no JSON overhead)
        if (isBinary) {
          if (activeSpeechSessionId) {
            const buf = data as Buffer;
            console.log(`🎤 [WebSocket] Binary audio chunk received: ${buf.length} bytes for ${activeSpeechSessionId}`);
            const sent = sendAudioChunk(activeSpeechSessionId, buf);
            if (!sent) {
              console.warn(`⚠️ [WebSocket] Failed to send binary audio for ${activeSpeechSessionId}`);
            }
          } else {
            console.warn(`⚠️ [WebSocket] Binary frame received but no activeSpeechSessionId`);
          }
          return;
        }

        const msg = JSON.parse(data.toString());
        
        // Play session subscription
        if (msg?.type === 'subscribe' && msg.sessionId) {
          addClient(String(msg.sessionId), ws);
          ws.send(JSON.stringify({ 
            type: 'session:subscribed', 
            sessionId: msg.sessionId 
          }));
        }
        
        // Speech streaming - start
        else if (msg?.type === 'speech:start') {
          const sessionId = msg.sessionId || `speech-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const locale = msg.locale || 'es-ES';
          const mimeType = msg.mimeType || '';
          activeSpeechSessionId = sessionId;
          console.log(`🚀 [WebSocket] speech:start — sessionId=${sessionId}, locale=${locale}, mimeType=${mimeType}`);
          startSpeechStream(ws, sessionId, locale, mimeType);
        }
        
        // Speech streaming - audio chunk (legacy base64 fallback)
        else if (msg?.type === 'speech:audio') {
          const { sessionId, audio } = msg;
          if (sessionId && audio) {
            const audioBuffer = Buffer.from(audio, 'base64');
            const sent = sendAudioChunk(sessionId, audioBuffer);
            if (!sent) {
              console.warn(`⚠️ [WebSocket] Failed to send audio chunk for ${sessionId}`);
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Session not found or inactive',
                sessionId,
              }));
            }
          }
        }
        
        // Speech streaming - stop
        else if (msg?.type === 'speech:stop') {
          const { sessionId } = msg;
          if (sessionId) {
            console.log(`🛑 [WebSocket] speech:stop — sessionId=${sessionId}`);
            stopSpeechStream(sessionId);
            activeSpeechSessionId = null;
          }
        }
        
      } catch (e: any) {
        console.error('❌ [WebSocket] Error handling message:', e.message);
      }
    });

    ws.on('close', () => {
      // Connection closed (log reduced)
      removeClient(ws);
    });
    
    ws.on('error', (error) => {
      console.error('❌ [WebSocket] Error:', error.message);
      removeClient(ws);
    });
  });

  console.info('✅ [WebSocket] Server attached to HTTP server');
  return { wss, port: null };
}
