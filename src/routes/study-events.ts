/**
 * Study Events routes
 */
import { Router } from 'express';
import { sql } from '../config/database.js';
import { requireAuth, getCurrentUser, type AuthRequest } from '../middleware/auth.js';
import { withErrorHandler } from '../middleware/error.js';
import type { CreateStudyEventBody } from '../types/api.types.js';

const router = Router();

/**
 * POST /api/study-events
 * Record a study event
 */
router.post('/', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  // Get userId directly from session (already verified by requireAuth middleware)
  const userId = req.session!.user.id;

  const body = req.body as CreateStudyEventBody & {
    deck_id?: string;
    mode?: string;
    response_type?: string;
    transcript_es?: string;
  };
  
  const { deck_id, card_id, result, mode, response_type, transcript_es } = body;

  const rows = await sql`
    INSERT INTO study_events (user_id, deck_id, card_id, result, mode, response_type, transcript_es)
    VALUES (${userId}, ${deck_id}, ${card_id}, ${result}, ${mode}, ${response_type}, ${transcript_es})
    RETURNING *
  `;

  return res.json(rows[0]);
}, 'POST /api/study-events'));

export default router;

