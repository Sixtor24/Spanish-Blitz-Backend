import { Router, type Request, type Response } from 'express';
import { requireAuth, getCurrentUser, type AuthRequest } from '../middleware/auth.js';
import { 
  synthesizeGoogleTTS, 
  listGoogleVoices, 
  getRecommendedGoogleVoice,
  checkGoogleTTSConfig 
} from '../services/google-cloud-tts.js';

const router = Router();

// Cache para almacenar audios generados (key: text-locale-gender)
const audioCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500; // Increased cache size

/**
 * POST /api/tts/synthesize
 * Generate speech audio from text using Google Cloud TTS
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
    let userVoiceId: string | null = null;
    
    try {
      const user = await getCurrentUser(req.session!);
      userPreferredGender = (user.preferred_voice_gender as 'male' | 'female') || 'female';
      userPreferredLocale = user.preferred_locale || 'es-ES';
      userVoiceId = (user as any).tts_voice_id || null;
      
      console.log('👤 [TTS] User preferences:', {
        email: user.email,
        preferredLocale: userPreferredLocale,
        preferredGender: userPreferredGender,
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

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Validar longitud del texto (Google Cloud TTS limit is ~5000 characters)
    if (text.length > 5000) {
      return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
    }

    // Normalizar locale - remover sufijos de género si existen
    if (typeof locale === 'string' && (locale.includes('-male') || locale.includes('-female'))) {
      locale = locale.replace(/-male$|-female$/, '');
    }

    // Asegurar que voiceGender sea válido
    if (voiceGender !== 'male' && voiceGender !== 'female') {
      voiceGender = 'male';
    }

    // Determinar voz de Google Cloud TTS
    const selectedVoice = userVoiceId || getRecommendedGoogleVoice(locale, voiceGender as 'male' | 'female');
    
    console.log('🔊 [Google Cloud TTS] Selected voice:', {
      locale,
      gender: voiceGender,
      voice: selectedVoice
    });
    
    const cacheKey = `google-${text}-${locale}-${voiceGender}${rate ? `-${rate}` : ''}`;

    // Verificar caché
    if (audioCache.has(cacheKey)) {
      console.log(`💾 [Google Cloud TTS] Using cached audio for: "${text.substring(0, 50)}" (${selectedVoice})`);
      const cachedAudio = audioCache.get(cacheKey)!;
      return res.json({
        audio: cachedAudio,
        contentType: 'audio/mp3',
        voice: selectedVoice,
        provider: 'Google Cloud TTS',
        cached: true,
      });
    }

    console.log(`🎤 [Google Cloud TTS] Generating audio for: "${text.substring(0, 50)}..." with voice: ${selectedVoice}${rate ? ` at rate: ${rate}` : ''}`);

    let audioBuffer: Buffer;
    try {
      audioBuffer = await synthesizeGoogleTTS(
        text,
        selectedVoice,
        locale,
        rate || '1.0'
      );
      
      if (!audioBuffer || audioBuffer.byteLength === 0) {
        throw new Error('Generated audio is empty');
      }
      
      console.log(`✅ [Google Cloud TTS] Audio generated successfully (${audioBuffer.length} bytes)`);
    } catch (genError: any) {
      console.error('[Google Cloud TTS] ❌ Generation error:', {
        message: genError.message,
        stack: genError.stack?.substring(0, 200),
        voice: selectedVoice,
        textLength: text.length
      });
      
      // Detectar errores de Google Cloud TTS
      if (genError.message?.includes('GOOGLE_APPLICATION_CREDENTIALS') || genError.message?.includes('Could not load')) {
        console.error('❌ [Google TTS] Credentials not configured');
        return res.status(500).json({
          error: 'Google Cloud TTS not configured',
          details: 'Server configuration error. Please contact support.',
          suggestion: 'Contact support to enable Google Cloud TTS'
        });
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
    
    const audioBase64 = audioBuffer.toString('base64');

    // Guardar en caché
    audioCache.set(cacheKey, audioBase64);

    // Limitar tamaño del caché
    if (audioCache.size > MAX_CACHE_SIZE) {
      const firstKey = audioCache.keys().next().value;
      if (firstKey) audioCache.delete(firstKey);
    }

    console.log(`✅ [Google Cloud TTS] Successfully generated and cached audio (cache size: ${audioCache.size})`);

    res.json({
      audio: audioBase64,
      contentType: 'audio/mp3',
      voice: selectedVoice,
      provider: 'Google Cloud TTS',
      cached: false,
    });
  } catch (error: any) {
    console.error('[Google Cloud TTS] ❌ Unexpected synthesis error:', {
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
 * List available Spanish voices from Google Cloud TTS
 */
router.get('/voices', async (req: Request, res: Response) => {
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
      configured: isConfigured,
      provider: 'Google Cloud TTS'
    });
  } catch (error: any) {
    res.json({ 
      configured: false,
      provider: 'Google Cloud TTS',
      error: error.message
    });
  }
});

export default router;
