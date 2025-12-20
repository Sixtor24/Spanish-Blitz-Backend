/**
 * Text-to-Speech routes using Microsoft Edge TTS (Voces Neuronales)
 * Las mejores voces gratuitas disponibles
 */
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

// Ruta al ejecutable de edge-tts
const EDGE_TTS_PATH = '/Users/komorebidev/Library/Python/3.9/bin/edge-tts';

// Mapeo de locales a voces neuronales de Microsoft Edge (Las mejores voces)
const VOICE_MAP: Record<string, string> = {
  // Voces femeninas
  'es-ES': 'es-ES-ElviraNeural',    // 👩 Mujer, España (Muy natural y amigable)
  'es-ES-female': 'es-ES-ElviraNeural',
  'es-MX': 'es-MX-DaliaNeural',     // 👩 Mujer, México (Acento mexicano)
  'es-AR': 'es-AR-ElenaNeural',     // 👩 Mujer, Argentina (Acento argentino)
  
  // Voces masculinas
  'es-ES-male': 'es-ES-AlvaroNeural',   // 👨 Hombre, España (Natural y claro)
  'es-MX-male': 'es-MX-JorgeNeural',    // 👨 Hombre, México (Acento mexicano)
  'es-AR-male': 'es-AR-TomasNeural',    // 👨 Hombre, Argentina (Acento argentino)
  'es-US': 'es-US-AlonsoNeural',        // 👨 Hombre, USA (Español latino)
  'es-US-male': 'es-US-AlonsoNeural',
};

/**
 * POST /api/tts/synthesize
 * Generate speech audio from text using Microsoft Edge TTS Neural Voices
 */
router.post('/synthesize', async (req: Request, res: Response) => {
  try {
    const { text, locale = 'es-ES' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Validar longitud del texto
    if (text.length > 500) {
      return res.status(400).json({ error: 'Text too long (max 500 characters)' });
    }

    const voice = VOICE_MAP[locale] || VOICE_MAP['es-ES'];
    const tempDir = path.join('/tmp', 'tts-audio');
    const tempFile = path.join(tempDir, `tts-${Date.now()}-${Math.random().toString(36).substring(7)}.mp3`);

    // Crear directorio temporal si no existe
    await fs.mkdir(tempDir, { recursive: true });

    // Escapar texto para shell (manejo seguro de comillas y caracteres especiales)
    const escapedText = text.replace(/'/g, "'\\''");

    // Generar audio con Microsoft Edge TTS Neural Voice
    const command = `${EDGE_TTS_PATH} --voice "${voice}" --text '${escapedText}' --write-media "${tempFile}"`;
    
    console.log(`[Edge TTS] 🎤 Generating neural audio for: "${text.substring(0, 50)}..." with voice: ${voice}`);
    
    await execAsync(command, { timeout: 15000 }); // 15 segundos timeout

    // Verificar que el archivo existe y tiene contenido
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

    console.log(`[Edge TTS] ✅ Successfully generated ${stats.size} bytes of neural audio`);

    res.json({
      audio: audioBase64,
      contentType: 'audio/mp3',
      voice,
      provider: 'Microsoft Edge TTS Neural',
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
 * List available Microsoft Edge Neural Voices
 */
router.get('/voices', async (req: Request, res: Response) => {
  try {
    const voices = Object.entries(VOICE_MAP).map(([locale, voice]) => ({
      locale,
      voice,
      provider: 'Microsoft Edge Neural',
      quality: 'Premium',
      language: locale.split('-')[0],
      region: locale.split('-')[1],
    }));
    
    res.json({ 
      voices,
      note: 'Microsoft Edge Neural Voices - Premium quality, completely free',
    });
  } catch (error: any) {
    console.error('[Edge TTS] Failed to list voices:', error.message);
    res.status(500).json({ error: 'Failed to list voices' });
  }
});

export default router;
