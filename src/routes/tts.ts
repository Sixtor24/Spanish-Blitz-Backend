import { Router, type Request, type Response } from 'express';
import { generateSpeech } from '@bestcodes/edge-tts/dist/index.mjs';
import { requireAuth, getCurrentUser, type AuthRequest } from '../middleware/auth.js';
import { 
  synthesizeGoogleTTS, 
  listGoogleVoices, 
  getRecommendedGoogleVoice,
  checkGoogleTTSConfig 
} from '../services/google-cloud-tts.js';

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
    
    // Obtener preferencias de TTS del usuario
    let userPreferredGender: 'male' | 'female' = 'female';
    let userPreferredLocale: string = 'es-ES';
    let userTTSProvider: 'edge' | 'google' = 'edge';
    let userVoiceId: string | null = null;
    
    try {
      const user = await getCurrentUser(req.session!);
      userPreferredGender = (user.preferred_voice_gender as 'male' | 'female') || 'female';
      userPreferredLocale = user.preferred_locale || 'es-ES';
      userTTSProvider = (user as any).tts_provider || 'edge';
      userVoiceId = (user as any).tts_voice_id || null;
      
      console.log('👤 [TTS] User preferences:', {
        email: user.email,
        preferredLocale: userPreferredLocale,
        preferredGender: userPreferredGender,
        ttsProvider: userTTSProvider,
        voiceId: userVoiceId,
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
    
    // Determinar provider a usar
    const provider = userTTSProvider;

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

    // Determinar voz según el provider
    let selectedVoice: string;
    if (provider === 'google') {
      // Si el usuario tiene una voz específica configurada, usarla
      selectedVoice = userVoiceId || getRecommendedGoogleVoice(locale, voiceGender as 'male' | 'female');
    } else {
      // Edge TTS (default)
      selectedVoice = VOICE_MAP[locale]?.[voiceGender as 'male' | 'female'] 
        || VOICE_MAP['es-ES'][voiceGender as 'male' | 'female'];
    }
    
    console.log('🔊 [TTS] Selected voice:', {
      provider,
      locale,
      gender: voiceGender,
      voice: selectedVoice
    });
    
    const cacheKey = `${provider}-${text}-${locale}-${voiceGender}${rate ? `-${rate}` : ''}`;

    // Verificar caché
    if (audioCache.has(cacheKey)) {
      console.log(`💾 [${provider.toUpperCase()} TTS] Using cached audio for: "${text.substring(0, 50)}" (${selectedVoice})`);
      const cachedAudio = audioCache.get(cacheKey)!;
      return res.json({
        audio: cachedAudio,
        contentType: 'audio/mp3',
        voice: selectedVoice,
        provider: provider === 'google' ? 'Google Cloud TTS' : 'Microsoft Edge TTS Neural',
        cached: true,
      });
    }

    console.log(`🎤 [${provider.toUpperCase()} TTS] Generating audio for: "${text.substring(0, 50)}..." with voice: ${selectedVoice}${rate ? ` at rate: ${rate}` : ''}`);

    let audioBuffer: Buffer | ArrayBuffer;
    try {
      if (provider === 'google') {
        // Google Cloud TTS
        audioBuffer = await synthesizeGoogleTTS(
          text,
          selectedVoice,
          locale,
          rate || '1.0'
        );
      } else {
        // Edge TTS (default)
        const options: any = { text, voice: selectedVoice };
        if (rate) options.rate = rate;
        audioBuffer = await generateSpeech(options);
      }
      
      if (!audioBuffer || audioBuffer.byteLength === 0) {
        throw new Error('Generated audio is empty');
      }
      
      const bufferLength = audioBuffer instanceof Buffer ? audioBuffer.length : audioBuffer.byteLength;
      console.log(`✅ [${provider.toUpperCase()} TTS] Audio generated successfully (${bufferLength} bytes)`);
    } catch (genError: any) {
      console.error(`[${provider.toUpperCase()} TTS] ❌ Generation error:`, {
        message: genError.message,
        stack: genError.stack?.substring(0, 200),
        voice: selectedVoice,
        textLength: text.length
      });
      
      // Detectar errores específicos del provider
      if (provider === 'edge') {
        const is403Error = genError.message?.includes('403') || 
                          genError.message?.toLowerCase().includes('forbidden');
        
        if (is403Error) {
          console.warn('⚠️ [Edge TTS] Microsoft service blocked (403) - frontend will fallback to Web Speech API');
          return res.status(503).json({
            error: 'Edge TTS temporarily unavailable',
            details: 'Microsoft TTS service is currently unavailable',
            fallback: 'web-speech-api',
            suggestion: 'Using browser native speech synthesis as fallback'
          });
        }
      } else if (provider === 'google') {
        // Errores de Google Cloud TTS
        if (genError.message?.includes('GOOGLE_APPLICATION_CREDENTIALS')) {
          console.error('❌ [Google TTS] Credentials not configured');
          return res.status(500).json({
            error: 'Google TTS not configured',
            details: 'Server configuration error',
            suggestion: 'Contact support or switch to Edge TTS in your profile'
          });
        }
      }
      
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
    
    const audioBase64 = audioBuffer instanceof Buffer 
      ? audioBuffer.toString('base64')
      : Buffer.from(new Uint8Array(audioBuffer)).toString('base64');

    // Guardar en caché
    audioCache.set(cacheKey, audioBase64);

    // Limitar tamaño del caché
    if (audioCache.size > MAX_CACHE_SIZE) {
      const firstKey = audioCache.keys().next().value;
      if (firstKey) audioCache.delete(firstKey);
    }

    console.log(`✅ [${provider.toUpperCase()} TTS] Successfully generated and cached audio (cache size: ${audioCache.size})`);

    res.json({
      audio: audioBase64,
      contentType: 'audio/mp3',
      voice: selectedVoice,
      provider: provider === 'google' ? 'Google Cloud TTS' : 'Microsoft Edge TTS Neural',
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

/**
 * GET /api/tts/google/voices
 * List available Spanish voices from Google Cloud TTS
 */
router.get('/google/voices', async (req: Request, res: Response) => {
  try {
    const voices = await listGoogleVoices();
    
    // Filtrar y formatear voces
    const formattedVoices = voices
      .filter(v => v.languageCodes?.some(code => code.startsWith('es')))
      .map(v => ({
        name: v.name,
        locale: v.languageCodes?.[0] || 'es-ES',
        gender: String(v.ssmlGender || 'NEUTRAL').toLowerCase(),
        language: v.languageCodes?.[0]?.split('-')[0] || 'es',
        region: v.languageCodes?.[0]?.split('-')[1] || 'ES',
      }));

    res.json({
      voices: formattedVoices,
      provider: 'Google Cloud TTS',
      count: formattedVoices.length,
    });
  } catch (error: any) {
    console.error('[Google TTS] ❌ Failed to list voices:', error.message);
    res.status(500).json({ 
      error: 'Failed to list Google voices',
      details: error.message,
      suggestion: 'Ensure GOOGLE_APPLICATION_CREDENTIALS is configured'
    });
  }
});

/**
 * GET /api/tts/config/check
 * Check if Google Cloud TTS is configured
 */
router.get('/config/check', async (req: Request, res: Response) => {
  try {
    const isConfigured = await checkGoogleTTSConfig();
    res.json({ 
      googleTTS: isConfigured,
      edgeTTS: true, // Edge TTS siempre disponible
    });
  } catch (error: any) {
    res.json({ 
      googleTTS: false,
      edgeTTS: true,
      error: error.message
    });
  }
});

export default router;
