/**
 * Google Cloud Text-to-Speech Service
 * High-quality neural voices with extensive language support
 */
import { TextToSpeechClient, protos } from '@google-cloud/text-to-speech';
import type { google } from '@google-cloud/text-to-speech/build/protos/protos';

type IVoice = google.cloud.texttospeech.v1.IVoice;
type ISynthesizeSpeechRequest = google.cloud.texttospeech.v1.ISynthesizeSpeechRequest;

// Configuración del cliente
let ttsClient: TextToSpeechClient | null = null;

function getClient(): TextToSpeechClient {
  if (!ttsClient) {
    // Soportar credenciales inline desde variable de entorno (para Railway/Heroku)
    const inlineCredentials = process.env.GOOGLE_CLOUD_CREDENTIALS_JSON;
    
    if (inlineCredentials) {
      // Credenciales inline: parsear JSON directamente
      try {
        const credentials = JSON.parse(inlineCredentials);
        console.log('✅ [Google TTS] Using inline credentials from GOOGLE_CLOUD_CREDENTIALS_JSON');
        ttsClient = new TextToSpeechClient({ credentials });
      } catch (error) {
        console.error('❌ [Google TTS] Failed to parse inline credentials:', error);
        throw new Error('Invalid GOOGLE_CLOUD_CREDENTIALS_JSON format');
      }
    } else {
      // Usar GOOGLE_APPLICATION_CREDENTIALS (path a archivo) o default credentials
      console.log('✅ [Google TTS] Using GOOGLE_APPLICATION_CREDENTIALS or default credentials');
      ttsClient = new TextToSpeechClient();
    }
  }
  return ttsClient;
}

/**
 * Voces recomendadas de Google Cloud TTS para español
 * Neural2 = Última generación con mejor calidad
 * Wavenet = Alta calidad
 * Standard = Calidad básica (más económico)
 */
/**
 * Google Cloud TTS solo soporta voces Neural2 para:
 * - es-ES (España)
 * - es-US (Latino/Estados Unidos - neutral)
 * 
 * No existen voces específicas para México, Argentina, Colombia, Chile, etc.
 */
export const GOOGLE_VOICE_MAP: Record<string, Record<'male' | 'female', string>> = {
  'es-ES': {
    male: 'es-ES-Neural2-F',    // Neural2 male voice (España)
    female: 'es-ES-Neural2-A',  // Neural2 female voice (España)
  },
  'es-US': {
    male: 'es-US-Neural2-B',    // Neural2 male voice (Latino/US - neutral)
    female: 'es-US-Neural2-A',  // Neural2 female voice (Latino/US - neutral)
  },
};

/**
 * Mapeo de locale a languageCode para Google Cloud TTS
 */
export const LOCALE_TO_LANGUAGE_CODE: Record<string, string> = {
  'es-ES': 'es-ES',  // España
  'es-US': 'es-US',  // Latino/Estados Unidos (neutral latinoamericano)
};

/**
 * Lista todas las voces disponibles en español de Google Cloud
 */
export async function listGoogleVoices(): Promise<IVoice[]> {
  try {
    const client = getClient();
    const [response] = await client.listVoices({
      languageCode: 'es', // Todas las voces en español
    });

    return response.voices || [];
  } catch (error: any) {
    console.error('❌ [Google TTS] Error listing voices:', error.message);
    throw error;
  }
}

/**
 * Sintetiza texto a audio usando Google Cloud TTS
 */
export async function synthesizeGoogleTTS(
  text: string,
  voiceName: string,
  locale: string = 'es-ES',
  rate: string = '1.0'
): Promise<Buffer> {
  try {
    const client = getClient();

    // Normalizar rate: "-40%" -> "0.6", "1.0" -> "1.0"
    let speakingRate = 1.0;
    if (rate.includes('%')) {
      const percentage = parseInt(rate.replace('%', ''));
      speakingRate = 1 + percentage / 100;
    } else {
      speakingRate = parseFloat(rate);
    }

    // Asegurar que speakingRate esté en el rango permitido (0.25 a 4.0)
    speakingRate = Math.max(0.25, Math.min(4.0, speakingRate));

    console.log(`🎤 [Google TTS] Synthesizing with voice: ${voiceName}, rate: ${speakingRate}`);

    // Obtener el languageCode correcto para el locale
    const languageCode = LOCALE_TO_LANGUAGE_CODE[locale] || 'es-US';
    
    const request: ISynthesizeSpeechRequest = {
      input: { text },
      voice: {
        languageCode: languageCode,
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: 'MP3' as any,
        speakingRate,
        pitch: 0,
        volumeGainDb: 0,
      },
    };

    const [response] = await client.synthesizeSpeech(request);

    if (!response.audioContent) {
      throw new Error('No audio content in response');
    }

    const audioBuffer = Buffer.from(response.audioContent as Uint8Array);
    console.log(`✅ [Google TTS] Audio generated successfully (${audioBuffer.length} bytes)`);

    return audioBuffer;
  } catch (error: any) {
    console.error('❌ [Google TTS] Synthesis error:', {
      message: error.message,
      voice: voiceName,
      locale,
    });
    throw error;
  }
}

/**
 * Obtiene la voz recomendada para un locale y género
 */
export function getRecommendedGoogleVoice(locale: string, gender: 'male' | 'female'): string {
  return GOOGLE_VOICE_MAP[locale]?.[gender] || GOOGLE_VOICE_MAP['es-ES'][gender];
}

/**
 * Verifica si Google Cloud TTS está configurado correctamente
 */
export async function checkGoogleTTSConfig(): Promise<boolean> {
  try {
    const client = getClient();
    // Test simple: listar voces
    await client.listVoices({ languageCode: 'es' });
    console.log('✅ [Google TTS] Configuration is valid');
    return true;
  } catch (error: any) {
    console.error('❌ [Google TTS] Configuration error:', error.message);
    console.error('Make sure GOOGLE_APPLICATION_CREDENTIALS is set correctly');
    return false;
  }
}
