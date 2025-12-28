import { Router, type Request, type Response } from 'express';
import { createClient } from '@deepgram/sdk';
import { config } from '../config/env.js';

const router = Router();

/**
 * POST /api/speech/transcribe
 * Transcribe audio using Deepgram (works in Brave browser)
 */
router.post('/transcribe', async (req: Request, res: Response) => {
  try {
    const { audio, locale = 'es-ES' } = req.body;

    if (!audio) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    // Validate audio format (should be base64 string)
    if (typeof audio !== 'string') {
      return res.status(400).json({ error: 'Audio must be a base64 string' });
    }

    // Get Deepgram API key from environment
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
    
    if (!deepgramApiKey) {
      console.error('[Speech] ❌ DEEPGRAM_API_KEY not configured');
      return res.status(500).json({ 
        error: 'Speech recognition service not configured. Please set DEEPGRAM_API_KEY environment variable.' 
      });
    }

    // Initialize Deepgram client
    const deepgram = createClient(deepgramApiKey);

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audio, 'base64');

    console.log(`🎤 [Speech] Transcribing audio (${audioBuffer.length} bytes, locale: ${locale})`);

    // Determine language code for Deepgram
    const languageCode = locale.startsWith('es') ? 'es' : 'en';
    
    // Transcribe audio using Deepgram with optimized settings
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: 'nova-2', // Fast and accurate model (best balance)
        language: languageCode,
        smart_format: true, // Automatically format numbers, dates, times, etc.
        punctuate: true, // Add punctuation automatically
        paragraphs: true, // Better paragraph detection and formatting
        utterances: true, // Detect natural speech pauses and breaks
        endpointing: 300, // Detect end of speech (300ms of silence)
        diarize: false, // Don't identify different speakers (single user scenario)
        multichannel: false, // Single channel audio (mono)
      }
    );

    if (error) {
      console.error('[Speech] ❌ Deepgram error:', error);
      return res.status(500).json({ 
        error: 'Transcription failed',
        details: error.message 
      });
    }

    // Extract transcript from Deepgram response
    // Deepgram can return results in different formats depending on options
    const channel = result?.results?.channels?.[0];
    const alternative = channel?.alternatives?.[0];
    const transcript = alternative?.transcript || '';

    if (!transcript || transcript.trim().length === 0) {
      console.warn('[Speech] ⚠️ No transcript found in response');
      return res.status(400).json({ 
        error: 'No speech detected in audio',
        transcript: '' 
      });
    }

    // Get confidence score (0-1, where 1 is highest confidence)
    const confidence = alternative?.confidence || 0;
    
    // Log transcription details
    console.log(`✅ [Speech] Transcription successful: "${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"`);
    console.log(`📊 [Speech] Confidence: ${(confidence * 100).toFixed(1)}%, Language: ${languageCode}`);

    res.json({
      transcript: transcript.trim(),
      confidence: confidence,
      language: locale,
      words: alternative?.words?.length || 0, // Number of words detected
    });
  } catch (error: any) {
    console.error('[Speech] ❌ Transcription error:', error);
    res.status(500).json({ 
      error: 'Transcription failed',
      details: error.message 
    });
  }
});

export default router;

