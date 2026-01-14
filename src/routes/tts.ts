import { Router, type Request, type Response } from 'express';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

const router = Router();

// Initialize AWS Polly client
const pollyClient = new PollyClient({ 
  region: process.env.AWS_REGION || 'us-east-1' // us-east-1 supports neural voices
});

// Mapeo de locales a voces neuronales de AWS Polly
// Solo incluimos los locales que Polly soporta nativamente
const VOICE_MAP: Record<string, Record<'male' | 'female', string>> = {
  'es-ES': { male: 'Sergio', female: 'Lucia' },    // España (default)
  'es-MX': { male: 'Andres', female: 'Mia' },      // México
  'es-US': { male: 'Pedro', female: 'Lupe' },      // Estados Unidos
};

// Cache para almacenar audios generados (key: text-locale-gender)
const audioCache = new Map<string, string>();

/**
 * POST /api/tts/synthesize
 * Generate speech audio from text using AWS Polly Neural
 */
router.post('/synthesize', async (req: Request, res: Response) => {
  try {
    let { text, locale = 'es-ES', voice: voiceGender = 'male' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Validar longitud del texto
    if (text.length > 3000) {
      return res.status(400).json({ error: 'Text too long (max 3000 characters)' });
    }

    // Normalizar locale
    if (typeof locale === 'string' && (locale.includes('-male') || locale.includes('-female'))) {
      locale = locale.replace(/-male$|-female$/, '');
    }

    // Asegurar que voiceGender sea válido
    if (voiceGender !== 'male' && voiceGender !== 'female') {
      voiceGender = 'male';
    }

    const selectedVoice = VOICE_MAP[locale]?.[voiceGender as 'male' | 'female'] || VOICE_MAP['es-ES'][voiceGender as 'male' | 'female'] || VOICE_MAP['es-ES']['male'];
    const cacheKey = `${text}-${locale}-${voiceGender}`;

    // Verificar caché
    if (audioCache.has(cacheKey)) {
      console.log(`💾 [AWS Polly] Using cached audio for: "${text.substring(0, 50)}" (${selectedVoice})`);
      const cachedAudio = audioCache.get(cacheKey)!;
      return res.json({
        audio: cachedAudio,
        contentType: 'audio/mp3',
        voice: selectedVoice,
        provider: 'AWS Polly Neural',
        cached: true,
      });
    }

    console.log(`🎤 [AWS Polly] Generating neural audio for: "${text.substring(0, 50)}..." with voice: ${selectedVoice}`);

    // Mapear locale a uno soportado por Polly
    // Polly solo soporta: es-ES, es-MX, es-US
    let pollyLocale = 'es-ES';
    if (locale === 'es-MX') {
      pollyLocale = 'es-MX';
    } else if (locale === 'es-US') {
      pollyLocale = 'es-US';
    }
    // Todos los demás (es-CO, es-AR, es-CL, etc.) usan es-ES
    
    // Generar audio con AWS Polly
    const command = new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: 'mp3',
      VoiceId: selectedVoice as any, // Polly voice IDs
      Engine: 'neural',
      LanguageCode: pollyLocale as any, // Polly language codes
    });

    const response = await pollyClient.send(command);
    
    if (!response.AudioStream) {
      throw new Error('No audio stream received from Polly');
    }

    // Convertir stream a buffer y luego a base64
    const chunks: Uint8Array[] = [];
    const stream = response.AudioStream as any;
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);
    const audioBase64 = audioBuffer.toString('base64');

    // Guardar en caché
    audioCache.set(cacheKey, audioBase64);

    // Limitar tamaño del caché a 100 elementos
    if (audioCache.size > 100) {
      const firstKey = audioCache.keys().next().value;
      if (firstKey) audioCache.delete(firstKey);
    }

    console.log(`✅ [AWS Polly] Successfully generated neural audio (cache size: ${audioCache.size})`);

    res.json({
      audio: audioBase64,
      contentType: 'audio/mp3',
      voice: selectedVoice,
      provider: 'AWS Polly Neural',
      cached: false,
    });
  } catch (error: any) {
    console.error('[AWS Polly] ❌ Synthesis error:', error.message);
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
    const voices = Object.entries(VOICE_MAP).flatMap(([locale, genders]) =>
      Object.entries(genders).map(([gender, voiceName]) => ({
        locale,
        gender,
        voice: voiceName,
        language: locale.split('-')[0],
        region: locale.split('-')[1],
      }))
    );

    res.json({ voices, provider: 'Microsoft Edge TTS Neural' });
  } catch (error: any) {
    console.error('[TTS] ❌ Failed to list voices:', error.message);
    res.status(500).json({ error: 'Failed to list voices' });
  }
});

export default router;
