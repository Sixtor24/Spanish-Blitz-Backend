/**
 * User routes
 */
import { Router } from 'express';
import { sql } from '../config/database.js';
import { requireAuth, getCurrentUser, type AuthRequest } from '../middleware/auth.js';
import { withErrorHandler } from '../middleware/error.js';
import type { UpdateUserBody } from '../types/api.types.js';

const router = Router();

/**
 * GET /api/users/current
 * Get current authenticated user
 */
router.get('/current', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  // Use user from session instead of querying by email for better performance
  const user = await getCurrentUser(req.session!);

  const rows = await sql`
    SELECT id, email, display_name, role, preferred_locale, preferred_voice_gender, is_premium, plan, has_seen_welcome, xp_total, created_at, updated_at
    FROM users
    WHERE id = ${user.id}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json(rows[0]);
}, 'GET /api/users/current'));

/**
 * PATCH /api/users/current
 * Update current user
 */
router.patch('/current', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const body = req.body as UpdateUserBody;
  const { display_name, preferred_locale, preferred_voice_gender } = body;
  const user = await getCurrentUser(req.session!);

  const rows = await sql`
    UPDATE users
    SET 
      display_name = COALESCE(${display_name}, display_name),
      preferred_locale = COALESCE(${preferred_locale}, preferred_locale),
      preferred_voice_gender = COALESCE(${preferred_voice_gender}, preferred_voice_gender),
      updated_at = NOW()
    WHERE id = ${user.id}
    RETURNING id, email, display_name, role, preferred_locale, preferred_voice_gender, is_premium, plan, has_seen_welcome, xp_total, created_at, updated_at
  `;

  if (rows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json(rows[0]);
}, 'PATCH /api/users/current'));

/**
 * POST /api/users/mark-welcome-seen
 * Mark welcome modal as seen
 */
router.post('/mark-welcome-seen', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);

  const rows = await sql`
    UPDATE users
    SET 
      has_seen_welcome = true,
      updated_at = NOW()
    WHERE id = ${user.id}
    RETURNING id, email, display_name, role, preferred_locale, preferred_voice_gender, is_premium, plan, has_seen_welcome, xp_total
  `;

  if (rows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json(rows[0]);
}, 'POST /api/users/mark-welcome-seen'));

export default router;

