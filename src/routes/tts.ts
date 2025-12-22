import { Router, type Request, type Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();
const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mapeo de locales a voces neuronales de Microsoft Edge
const VOICE_MAP: Record<string, Record<'male' | 'female', string>> = {
  'es-ES': { male: 'es-ES-AlvaroNeural', female: 'es-ES-ElviraNeural' },
  'es-MX': { male: 'es-MX-JorgeNeural', female: 'es-MX-DaliaNeural' },
  'es-AR': { male: 'es-AR-TomasNeural', female: 'es-AR-ElenaNeural' },
  'es-US': { male: 'es-US-AlonsoNeural', female: 'es-US-PalomaNeural' },
  'es-CO': { male: 'es-CO-GonzaloNeural', female: 'es-CO-SalomeNeural' },
  'es-CL': { male: 'es-CL-LorenzoNeural', female: 'es-CL-CatalinaNeural' },
};

// Cache para almacenar audios generados (key: text-locale-gender)
const audioCache = new Map<string, string>();

/**
 * POST /api/tts/synthesize
 * Generate speech audio from text using Microsoft Edge TTS
 */
router.post('/synthesize', async (req: Request, res: Response) => {
  try {
    const { text, locale = 'es-ES', voice: voiceGender = 'male' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Validar longitud del texto
    if (text.length > 500) {
      return res.status(400).json({ error: 'Text too long (max 500 characters)' });
    }

    const selectedVoice = VOICE_MAP[locale]?.[voiceGender as 'male' | 'female'] || VOICE_MAP['es-ES'][voiceGender as 'male' | 'female'] || VOICE_MAP['es-ES']['male'];
    const cacheKey = `${text}-${locale}-${voiceGender}`;

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

    const tempDir = path.join('/tmp', 'tts-audio');
    const tempFile = path.join(tempDir, `tts-${Date.now()}-${Math.random().toString(36).substring(7)}.mp3`);

    // Crear directorio temporal si no existe
    await fs.mkdir(tempDir, { recursive: true });

    // Escapar texto para shell
    const escapedText = text.replace(/'/g, "'\\''");

    // Generar audio con edge-tts
    // En Railway: usa 'edge-tts' del PATH (instalado por nixpacks)
    // En local: usa python3 con la ruta completa si está definida, sino busca en PATH
    const edgeTtsPath = process.env.EDGE_TTS_PATH;
    let command: string;
    
    if (edgeTtsPath && edgeTtsPath.includes('/')) {
      // Ruta local completa - ejecutar con python3
      command = `python3 "${edgeTtsPath}" --voice "${selectedVoice}" --text '${escapedText}' --write-media "${tempFile}"`;
    } else {
      // Railway o PATH - usar directamente edge-tts
      command = `edge-tts --voice "${selectedVoice}" --text '${escapedText}' --write-media "${tempFile}"`;
    }

    console.log(`🎤 [Edge TTS] Generating neural audio for: "${text.substring(0, 50)}..." with voice: ${selectedVoice} (${locale} ${voiceGender})`);

    await execAsync(command, { timeout: 10000 }); // 10 segundos timeout

    // Verificar que el archivo existe
    const stats = await fs.stat(tempFile);
    if (stats.size === 0) {
      throw new Error('Generated audio file is empty');
    }

    // Leer archivo y convertir a base64
    const audioBuffer = await fs.readFile(tempFile);
    const audioBase64 = audioBuffer.toString('base64');

    // Limpiar archivo temporal
    await fs.unlink(tempFile).catch((err) => {
      console.warn('[Edge TTS] Failed to delete temp file:', err.message);
    });

    // Guardar en caché
    audioCache.set(cacheKey, audioBase64);

    // Limitar tamaño del caché a 100 elementos
    if (audioCache.size > 100) {
      const firstKey = audioCache.keys().next().value;
      if (firstKey) audioCache.delete(firstKey);
    }

    console.log(`✅ [Edge TTS] Successfully generated ${stats.size} bytes of neural audio (cache size: ${audioCache.size})`);

    res.json({
      audio: audioBase64,
      contentType: 'audio/mp3',
      voice: selectedVoice,
      provider: 'Microsoft Edge TTS Neural',
      cached: false,
    });
  } catch (error: any) {
    console.error('[Edge TTS] ❌ Synthesis error:', error.message);
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
