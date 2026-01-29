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
    // Las credenciales se pueden configurar de 3 maneras:
    // 1. Variable de entorno GOOGLE_APPLICATION_CREDENTIALS apuntando al JSON
    // 2. Pasar credenciales explícitamente (ver documentación)
    // 3. Usar default credentials si estás en Google Cloud
    ttsClient = new TextToSpeechClient();
  }
  return ttsClient;
}

/**
 * Voces recomendadas de Google Cloud TTS para español
 * Neural2 = Última generación con mejor calidad
 * Wavenet = Alta calidad
 * Standard = Calidad básica (más económico)
 */
export const GOOGLE_VOICE_MAP: Record<string, Record<'male' | 'female', string>> = {
  'es-ES': {
    male: 'es-ES-Neural2-F',    // Neural2 male voice (España)
    female: 'es-ES-Neural2-A',  // Neural2 female voice (España)
  },
  'es-MX': {
    male: 'es-US-Neural2-B',    // Neural2 male voice (México/US)
    female: 'es-US-Neural2-A',  // Neural2 female voice (México/US)
  },
  'es-AR': {
    male: 'es-US-Neural2-B',    // Fallback a US (Google no tiene AR específico)
    female: 'es-US-Neural2-A',
  },
  'es-CO': {
    male: 'es-US-Neural2-B',    // Fallback a US
    female: 'es-US-Neural2-A',
  },
  'es-CL': {
    male: 'es-US-Neural2-B',    // Fallback a US
    female: 'es-US-Neural2-A',
  },
  'es-US': {
    male: 'es-US-Neural2-B',
    female: 'es-US-Neural2-A',
  },
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

    const request: ISynthesizeSpeechRequest = {
      input: { text },
      voice: {
        languageCode: locale.split('-')[0] + '-' + locale.split('-')[1], // e.g., "es-ES"
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
