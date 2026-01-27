import { Router, type Request, type Response } from 'express';
import { generateSpeech } from '@bestcodes/edge-tts/dist/index.mjs';
import { requireAuth, getCurrentUser, type AuthRequest } from '../middleware/auth.js';

const router = Router();

// Microsoft Edge TTS voice mapping (from PRD)
const VOICE_MAP: Record<string, Record<'male' | 'female', string>> = {
  'es-ES': { male: 'es-ES-AlvaroNeural', female: 'es-ES-ElviraNeural' },    // España
  'es-MX': { male: 'es-MX-JorgeNeural', female: 'es-MX-DaliaNeural' },      // México
  'es-AR': { male: 'es-AR-TomasNeural', female: 'es-AR-ElenaNeural' },      // Argentina
  'es-US': { male: 'es-US-AlonsoNeural', female: 'es-US-PalomaNeural' },    // Estados Unidos
  'es-CO': { male: 'es-CO-GonzaloNeural', female: 'es-CO-SalomeNeural' },   // Colombia
  'es-CL': { male: 'es-CL-LorenzoNeural', female: 'es-CL-CatalinaNeural' }, // Chile
};

// Cache para almacenar audios generados (key: text-locale-gender)
const audioCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500; // Increased cache size

/**
 * POST /api/tts/synthesize
 * Generate speech audio from text using Microsoft Edge TTS
 */
router.post('/synthesize', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    let { text, locale = 'es-ES', voice: voiceGender, rate } = req.body;
    
    console.log('🎤 [TTS] Request received:', { 
      text: text?.substring(0, 30) + '...', 
      locale, 
      voiceGender: voiceGender || 'not specified',
      rate: rate || 'normal'
    });
    
    // Obtener preferencia de género de voz del usuario si está autenticado
    let userPreferredGender: 'male' | 'female' = 'female';
    let userPreferredLocale: string = 'es-ES';
    try {
      const user = await getCurrentUser(req.session!);
      userPreferredGender = (user.preferred_voice_gender as 'male' | 'female') || 'female';
      userPreferredLocale = user.preferred_locale || 'es-ES';
      
      console.log('👤 [TTS] User preferences:', {
        email: user.email,
        preferredLocale: userPreferredLocale,
        preferredGender: userPreferredGender,
        plan: user.plan,
        isPremium: user.is_premium
      });
    } catch (error) {
      console.log('⚠️ Could not get user preferences, using default');
    }
    
    // Si no se especifica género en la petición, usar preferencia del usuario
    if (!voiceGender) {
      voiceGender = userPreferredGender;
    }

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Validar longitud del texto (Edge TTS limit is ~500 characters)
    if (text.length > 500) {
      return res.status(400).json({ error: 'Text too long (max 500 characters)' });
    }

    // Normalizar locale - remover sufijos de género si existen
    if (typeof locale === 'string' && (locale.includes('-male') || locale.includes('-female'))) {
      locale = locale.replace(/-male$|-female$/, '');
    }

    // Asegurar que voiceGender sea válido
    if (voiceGender !== 'male' && voiceGender !== 'female') {
      voiceGender = 'male';
    }

    // Seleccionar voz - si locale no está en el mapa, usar es-ES por defecto
    const selectedVoice = VOICE_MAP[locale]?.[voiceGender as 'male' | 'female'] 
      || VOICE_MAP['es-ES'][voiceGender as 'male' | 'female'];
    
    console.log('🔊 [TTS] Selected voice:', {
      locale,
      gender: voiceGender,
      voice: selectedVoice
    });
    
    const cacheKey = `${text}-${locale}-${voiceGender}${rate ? `-${rate}` : ''}`;

    // Verificar caché
    if (audioCache.has(cacheKey)) {
      console.log(`💾 [Edge TTS] Using cached audio for: "${text.substring(0, 50)}" (${selectedVoice})`);
      const cachedAudio = audioCache.get(cacheKey)!;
      return res.json({
        audio: cachedAudio,
        contentType: 'audio/mp3',
        voice: selectedVoice,
        provider: 'Microsoft Edge TTS Neural',
        cached: true,
      });
    }

    console.log(`🎤 [Edge TTS] Generating audio for: "${text.substring(0, 50)}..." with voice: ${selectedVoice}${rate ? ` at rate: ${rate}` : ''}`);

    // Generar audio con Edge TTS
    const options: any = { text, voice: selectedVoice };
    if (rate) options.rate = rate;
    
    let audioBuffer: ArrayBuffer;
    try {
      audioBuffer = await generateSpeech(options);
      
      if (!audioBuffer || audioBuffer.byteLength === 0) {
        throw new Error('Generated audio is empty');
      }
      
      console.log(`✅ [Edge TTS] Audio generated successfully (${audioBuffer.byteLength} bytes)`);
    } catch (genError: any) {
      console.error('[Edge TTS] ❌ Generation error:', {
        message: genError.message,
        stack: genError.stack?.substring(0, 200),
        voice: selectedVoice,
        textLength: text.length
      });
      
      // Proporcionar mensaje más descriptivo según el tipo de error
      let errorMessage = 'Failed to generate speech audio';
      if (genError.message?.includes('network') || genError.message?.includes('fetch')) {
        errorMessage = 'Network error connecting to TTS service. Check your internet connection.';
      } else if (genError.message?.includes('timeout')) {
        errorMessage = 'TTS request timed out. Please try again.';
      } else if (genError.message?.includes('voice')) {
        errorMessage = `Voice "${selectedVoice}" is not available`;
      }
      
      return res.status(500).json({
        error: errorMessage,
        details: genError.message,
        voice: selectedVoice,
        locale,
        suggestion: 'If the error persists, try using a different Spanish dialect in your profile settings.'
      });
    }
    
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    // Guardar en caché
    audioCache.set(cacheKey, audioBase64);

    // Limitar tamaño del caché
    if (audioCache.size > MAX_CACHE_SIZE) {
      const firstKey = audioCache.keys().next().value;
      if (firstKey) audioCache.delete(firstKey);
    }

    console.log(`✅ [Edge TTS] Successfully generated and cached audio (cache size: ${audioCache.size})`);

    res.json({
      audio: audioBase64,
      contentType: 'audio/mp3',
      voice: selectedVoice,
      provider: 'Microsoft Edge TTS Neural',
      cached: false,
    });
  } catch (error: any) {
    console.error('[Edge TTS] ❌ Unexpected synthesis error:', {
      message: error.message,
      stack: error.stack?.substring(0, 300),
      env: process.env.NODE_ENV
    });
    
    res.status(500).json({
      error: 'TTS synthesis failed unexpectedly',
      details: error.message,
      suggestion: 'Please check server logs for more details.'
    });
  }
});

/**
 * GET /api/tts/voices
 * List available Spanish voices from Microsoft Edge TTS
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

    res.json({ 
      voices, 
      provider: 'Microsoft Edge TTS Neural',
      count: voices.length
    });
  } catch (error: any) {
    console.error('[TTS] ❌ Failed to list voices:', error.message);
    res.status(500).json({ error: 'Failed to list voices' });
  }
});

export default router;
