/**
 * Deepgram Streaming Service for Real-time Speech Recognition
 * Handles WebSocket connections and Deepgram live transcription
 * Works on all platforms (web and mobile)
 */
import { createClient, type LiveClient } from '@deepgram/sdk';
import type { WebSocket } from 'ws';

interface StreamingSession {
  connection: any; // Deepgram live connection
  locale: string;
  isActive: boolean;
  startTime: number;
}

const activeStreams = new Map<string, StreamingSession>();

// Constants
const SESSION_TIMEOUT = 30000; // 30 seconds timeout for inactive sessions
const MAX_SESSIONS = 100; // Maximum concurrent sessions

/**
 * Clean up old sessions
 */
function cleanupOldSessions() {
  const now = Date.now();
  for (const [sessionId, session] of activeStreams.entries()) {
    if (now - session.startTime > SESSION_TIMEOUT) {
      console.log(`🧹 [Speech Stream] Cleaning up old session: ${sessionId}`);
      try {
        if (session.connection) {
          session.connection.finish();
        }
      } catch (e) {
        console.warn(`Failed to close session ${sessionId}:`, e);
      }
      activeStreams.delete(sessionId);
    }
  }
}

// Cleanup every 10 seconds
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

    console.log(`🎤 [Speech Stream] Starting session: ${sessionId} (locale: ${locale})`);

    // Create Deepgram client
    const deepgram = createClient(deepgramApiKey);

    // Create live connection optimized for Spanish
    const connection = deepgram.listen.live({
      model: 'nova-2', // Best balance of speed and accuracy
      language: 'es', // Always Spanish - platform for English speakers learning Spanish
      smart_format: true,
      punctuate: true,
      interim_results: true, // Real-time partial results
      endpointing: 1, // 150ms silence = muy rápido pero confiable
      utterances: false, // Don't split into utterances
      vad_events: false, // Don't send voice activity detection events
    });

    // Store session
    activeStreams.set(sessionId, {
      connection,
      locale,
      isActive: true,
      startTime: Date.now(),
    });

    // Handle connection open
    connection.on('open', () => {
      console.log(`✅ [Speech Stream] Deepgram connection OPENED: ${sessionId}`);
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
            console.log(`✅ [Speech Stream] Final transcript (${sessionId}): "${transcript}" (confidence: ${(confidence * 100).toFixed(1)}%)`);
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

    // Handle connection close
    connection.on('close', () => {
      console.log(`🔌 [Speech Stream] Connection closed: ${sessionId}`);
      activeStreams.delete(sessionId);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'stream:closed',
          sessionId,
        }));
      }
    });

    // Handle WebSocket close
    ws.on('close', () => {
      stopSpeechStream(sessionId);
    });

    ws.on('error', () => {
      stopSpeechStream(sessionId);
    });

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
    console.warn(`⚠️ [Speech Stream] Session not found or inactive: ${sessionId}`);
    return false;
  }

  try {
    if (session.connection && session.connection.getReadyState() === 1) {
      session.connection.send(audioBuffer);
      // Reduced logging - only log errors, not every chunk
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
 * Stop streaming session
 */
export function stopSpeechStream(sessionId: string): void {
  const session = activeStreams.get(sessionId);
  if (!session) return;

  console.log(`🛑 [Speech Stream] Stopping session: ${sessionId}`);

  try {
    if (session.connection) {
      session.connection.finish();
    }
  } catch (error: any) {
    console.error(`❌ [Speech Stream] Error stopping session (${sessionId}):`, error);
  }

  activeStreams.delete(sessionId);
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
