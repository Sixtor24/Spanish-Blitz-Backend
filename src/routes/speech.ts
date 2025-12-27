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

    // Transcribe audio using Deepgram
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: 'nova-2',
        language: locale.startsWith('es') ? 'es' : 'en',
        smart_format: true,
        punctuate: true,
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
    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

    if (!transcript || transcript.trim().length === 0) {
      console.warn('[Speech] ⚠️ No transcript found in response');
      return res.status(400).json({ 
        error: 'No speech detected in audio',
        transcript: '' 
      });
    }

    console.log(`✅ [Speech] Transcription successful: "${transcript}"`);

    res.json({
      transcript: transcript.trim(),
      confidence: result?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0,
      language: locale,
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

