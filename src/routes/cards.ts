/**
 * Card routes
 */
import { Router } from 'express';
import { sql } from '../config/database.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { withErrorHandler, ApiError } from '../middleware/error.js';

const router = Router();

/**
 * GET /api/cards/:id
 * Get card by ID
 */
router.get('/:id', withErrorHandler(async (req, res) => {
  const { id } = req.params;

  const rows = await sql`
    SELECT 
      id,
      deck_id,
      question,
      answer,
      question as prompt_es,
      answer as translation_en,
      notes,
      audio_url,
      image_url,
      created_at,
      updated_at
    FROM cards 
    WHERE id = ${id} 
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new ApiError(404, "Card not found");
  }

  return res.json(rows[0]);
}, 'GET /api/cards/:id'));

/**
 * PATCH /api/cards/:id
 * Update card
 */
router.patch('/:id', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const { id } = req.params;
  const {
    prompt_es,
    answer_es,
    distractor_1_es,
    distractor_2_es,
    distractor_3_es,
    notes,
    translation_en,
  } = req.body;

  // Truncate notes to 150 characters if provided
  let truncatedNotes = notes;
  if (notes !== undefined && notes !== null) {
    const trimmed = notes.trim();
    // Treat empty string as null
    truncatedNotes = trimmed.length === 0 ? null : (trimmed.length > 150 ? trimmed.substring(0, 150) : trimmed);
  }

  const rows = await sql`
    UPDATE cards
    SET 
      question = COALESCE(${prompt_es}, question),
      answer = COALESCE(${translation_en || answer_es}, answer),
      notes = CASE 
        WHEN ${notes !== undefined} THEN ${truncatedNotes}
        ELSE notes
      END,
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  if (rows.length === 0) {
    throw new ApiError(404, "Card not found");
  }

  return res.json(rows[0]);
}, 'PATCH /api/cards/:id'));

/**
 * DELETE /api/cards/:id
 * Delete card
 */
router.delete('/:id', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const { id } = req.params;

  await sql`DELETE FROM cards WHERE id = ${id}`;

  return res.json({ success: true });
}, 'DELETE /api/cards/:id'));

export default router;

