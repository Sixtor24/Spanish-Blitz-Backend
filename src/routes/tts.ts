import { Router, type Request, type Response } from 'express';
import googleTTS from 'google-tts-api';

const router = Router();

// Mapeo de locales a voces de Google (con soporte para male/female)
const VOICE_MAP: Record<string, { locale: string; name: string }> = {
  'es-ES': { locale: 'es-ES', name: 'Spanish (Spain)' },
  'es-MX': { locale: 'es-MX', name: 'Spanish (Mexico)' },
  'es-AR': { locale: 'es-AR', name: 'Spanish (Argentina)' },
  'es-US': { locale: 'es-US', name: 'Spanish (United States)' },
  'es-CO': { locale: 'es-CO', name: 'Spanish (Colombia)' },
  'es-CL': { locale: 'es-CL', name: 'Spanish (Chile)' },
};

// Cache para almacenar audios generados (key: text-locale-gender)
const audioCache = new Map<string, string>();

/**
 * POST /api/tts/synthesize
 * Generate speech audio from text using Google TTS
 */
router.post('/synthesize', async (req: Request, res: Response) => {
  try {
    const { text, locale = 'es-ES', voice: voiceGender = 'male' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Validar longitud del texto
    if (text.length > 200) {
      return res.status(400).json({ error: 'Text too long (max 200 characters)' });
    }

    const selectedLocale = VOICE_MAP[locale]?.locale || 'es-ES';
    const cacheKey = `${text}-${selectedLocale}-${voiceGender}`;

    // Verificar caché
    if (audioCache.has(cacheKey)) {
      console.log(`💾 [Google TTS] Using cached audio for: "${text.substring(0, 50)}"`);
      const cachedAudio = audioCache.get(cacheKey)!;
      return res.json({
        audio: cachedAudio,
        contentType: 'audio/mp3',
        voice: selectedLocale,
        provider: 'Google TTS',
        cached: true,
      });
    }

    console.log(`🎤 [Google TTS] Generating audio for: "${text.substring(0, 50)}..." (${selectedLocale}, ${voiceGender})`);

    // Generar URL de audio con Google TTS
    const audioUrl = googleTTS.getAudioUrl(text, {
      lang: selectedLocale,
      slow: false,
      host: 'https://translate.google.com',
    });

    // Descargar el audio
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to fetch audio: ${audioResponse.statusText}`);
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    // Guardar en caché
    audioCache.set(cacheKey, audioBase64);

    // Limitar tamaño del caché a 100 elementos
    if (audioCache.size > 100) {
      const firstKey = audioCache.keys().next().value;
      audioCache.delete(firstKey);
    }

    console.log(`✅ [Google TTS] Successfully generated audio (${audioBuffer.byteLength} bytes, cache: ${audioCache.size})`);

    res.json({
      audio: audioBase64,
      contentType: 'audio/mp3',
      voice: selectedLocale,
      provider: 'Google TTS',
      cached: false,
    });
  } catch (error: any) {
    console.error('[Google TTS] ❌ Synthesis error:', error.message);
    res.status(500).json({
      error: 'TTS synthesis failed',
      details: error.message,
    });
  }
});

/**
 * GET /api/tts/voices
 * List available Spanish voices
 */
router.get('/voices', async (req: Request, res: Response) => {
  try {
    const voices = Object.entries(VOICE_MAP).map(([key, value]) => ({
      locale: value.locale,
      name: value.name,
      language: value.locale.split('-')[0],
      region: value.locale.split('-')[1],
    }));

    res.json({ voices, provider: 'Google TTS' });
  } catch (error: any) {
    console.error('[TTS] ❌ Failed to list voices:', error.message);
    res.status(500).json({ error: 'Failed to list voices' });
  }
});

export default router;
