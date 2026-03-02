/**
 * Deepgram Streaming Service for Real-time Speech Recognition
 * Optimized for a language learning platform where students speak at
 * different speeds. Supports slow syllable-by-syllable pronunciation
 * and fast fluent speech equally well.
 */
import { createClient, type LiveClient } from '@deepgram/sdk';
import type { WebSocket } from 'ws';

interface StreamingSession {
  connection: any;
  clientWs: WebSocket;
  locale: string;
  isActive: boolean;
  startTime: number;
  lastActivity: number;
  keepaliveTimer: ReturnType<typeof setInterval>;
}

const activeStreams = new Map<string, StreamingSession>();

const SESSION_TIMEOUT = 20000;         // 20s — slow speakers + processing time
const MAX_SESSIONS = 200;              // Concurrent sessions for Blitz Challenge
const KEEPALIVE_INTERVAL = 5000;       // 5s keepalive ping
const FINALIZE_GRACE_PERIOD = 3000;    // 3s grace after stop to receive final transcript

/**
 * Clean up stale sessions based on last activity, not just start time
 */
function cleanupOldSessions() {
  const now = Date.now();
  for (const [sessionId, session] of activeStreams.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      try {
        clearInterval(session.keepaliveTimer);
        session.connection?.finish();
      } catch (e) {
        // Session may already be closed
      }
      activeStreams.delete(sessionId);
    }
  }
}

setInterval(cleanupOldSessions, 10000);

/**
 * Start a new streaming transcription session
 */
export function startSpeechStream(ws: WebSocket, sessionId: string, locale: string = 'es-ES'): void {
  try {
    // Check API key
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramApiKey) {
      console.error('❌ [Speech Stream] DEEPGRAM_API_KEY not configured');
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Speech recognition service not configured',
        sessionId,
      }));
      return;
    }

    // Check max sessions
    if (activeStreams.size >= MAX_SESSIONS) {
      console.warn(`⚠️ [Speech Stream] Max sessions reached (${MAX_SESSIONS})`);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Server busy, please try again',
        sessionId,
      }));
      return;
    }

    // Check if session already exists
    if (activeStreams.has(sessionId)) {
      console.warn(`⚠️ [Speech Stream] Session already exists: ${sessionId}`);
      stopSpeechStream(sessionId);
    }

    // Starting speech session

    // Create Deepgram client
    const deepgram = createClient(deepgramApiKey);

    // Create live connection
    const connection = deepgram.listen.live({
      model: 'nova-2',
      language: 'es',
      smart_format: true,
      interim_results: true,
      endpointing: 1500,       // Wait 1500ms of silence before finalizing (default ~300ms - too short for slow speech)
      utterance_end_ms: 2000,  // Send UtteranceEnd event after 2s of silence
      no_delay: true,          // Reduce latency on interim results
    });

    // Store session with keepalive
    const now = Date.now();
    const keepaliveTimer = setInterval(() => {
      if (connection && connection.getReadyState() === 1) {
        try {
          connection.keepAlive();
        } catch (e) {
          console.warn(`⚠️ [Speech Stream] Keepalive failed for ${sessionId}`);
        }
      }
    }, KEEPALIVE_INTERVAL);

    activeStreams.set(sessionId, {
      connection,
      clientWs: ws,
      locale,
      isActive: true,
      startTime: now,
      lastActivity: now,
      keepaliveTimer,
    });

    // Handle connection open
    connection.on('open', () => {
      // Deepgram connection opened
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify({
          type: 'stream:started',
          sessionId,
        }));
      }
    });

    // Handle transcription results
    // IMPORTANT: The correct event name is "Results" not "Transcript"
    connection.on('Results', (data: any) => {
      try {
        if (ws.readyState !== 1) return; // Only send if WebSocket is open

        // Parse Deepgram response
        const channel = data?.channel?.alternatives?.[0];
        if (!channel) {
          console.warn(`⚠️ [Speech Stream] No channel in Deepgram response for ${sessionId}`);
          return;
        }

        const transcript = channel.transcript || '';
        const isFinal = data.is_final || false;
        const confidence = channel.confidence || 0;

        if (transcript && transcript.trim()) {
          // Only log final transcripts to reduce noise
          if (isFinal) {
            // Final transcript received
          }
          ws.send(JSON.stringify({
            type: 'transcript',
            transcript: transcript.trim(),
            isFinal,
            confidence,
            sessionId,
          }));
        }
      } catch (error: any) {
        console.error(`❌ [Speech Stream] Error processing Results (${sessionId}):`, error);
      }
    });

    // Handle errors
    connection.on('error', (error: any) => {
      console.error(`❌ [Speech Stream] Deepgram error (${sessionId}):`, error);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Transcription error',
          sessionId,
        }));
      }
    });

    // Handle Deepgram connection close
    connection.on('close', () => {
      // Deepgram connection closed
      activeStreams.delete(sessionId);
      // DO NOT send stream:closed to client - client WebSocket stays open
      // DO NOT close client WebSocket - it's persistent and reused
    });

    // NOTE: WebSocket close/error handlers are NOT added here
    // The client WebSocket is persistent and managed by ws-hub.ts
    // Only Deepgram sessions are created/destroyed per recording

  } catch (error: any) {
    console.error(`❌ [Speech Stream] Failed to start session (${sessionId}):`, error);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to start transcription',
        sessionId,
      }));
    }
  }
}

/**
 * Send audio chunk to streaming session
 */
export function sendAudioChunk(sessionId: string, audioBuffer: Buffer): boolean {
  const session = activeStreams.get(sessionId);
  
  if (!session || !session.isActive) {
    return false;
  }

  try {
    if (session.connection && session.connection.getReadyState() === 1) {
      session.connection.send(audioBuffer);
      session.lastActivity = Date.now();
      return true;
    } else {
      console.warn(`⚠️ [Speech Stream] Connection not ready for ${sessionId}: state=${session.connection?.getReadyState()}`);
    }
    return false;
  } catch (error: any) {
    console.error(`❌ [Speech Stream] Error sending audio (${sessionId}):`, error);
    return false;
  }
}

/**
 * Stop streaming session gracefully.
 * Sends finish signal to Deepgram so it flushes any remaining audio
 * and sends the final transcript. Waits a grace period before cleanup
 * so the Results handler can still forward the final transcript to the client.
 * IMPORTANT: This only closes the Deepgram session, NOT the client WebSocket.
 */
export function stopSpeechStream(sessionId: string): void {
  const session = activeStreams.get(sessionId);
  if (!session) return;

  // Mark inactive immediately — reject any new audio chunks
  session.isActive = false;

  // Clear keepalive (no longer needed)
  clearInterval(session.keepaliveTimer);

  try {
    if (session.connection && session.connection.getReadyState() === 1) {
      // finish() tells Deepgram to process remaining audio and send final transcript
      // The Results handler will forward it to the client before the connection closes
      session.connection.finish();

      // Grace period: let Deepgram send final transcript before we remove the session
      // The session stays in the map so the Results/close handlers can still fire
      setTimeout(() => {
        activeStreams.delete(sessionId);
      }, FINALIZE_GRACE_PERIOD);
    } else {
      // Connection already closed, clean up immediately
      activeStreams.delete(sessionId);
    }
  } catch (error: any) {
    console.error(`❌ [Speech Stream] Error stopping session (${sessionId}):`, error);
    activeStreams.delete(sessionId);
  }
}

/**
 * Check if a session is active
 */
export function isStreamActive(sessionId: string): boolean {
  return activeStreams.has(sessionId) && activeStreams.get(sessionId)?.isActive === true;
}

/**
 * Get number of active sessions
 */
export function getActiveSessionsCount(): number {
  return activeStreams.size;
}
