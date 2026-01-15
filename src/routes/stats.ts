/**
 * Stats routes
 */
import { Router } from 'express';
import { sql } from '../config/database.js';
import { requireAuth, getCurrentUser, type AuthRequest } from '../middleware/auth.js';
import { withErrorHandler } from '../middleware/error.js';
import type { StatsResponse } from '../types/api.types.js';

const router = Router();

/**
 * GET /api/stats
 * Get user statistics
 */
router.get('/', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);

  // Combine all stats into a single query for better performance
  const statsRows = await sql`
    SELECT 
      COUNT(DISTINCT card_id) as cards_studied,
      COUNT(*) FILTER (WHERE result = 'correct') as correct,
      COUNT(*) as total,
      COUNT(DISTINCT DATE(created_at)) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as streak
    FROM study_events
    WHERE user_id = ${user.id}
  `;

  const stats = statsRows[0];
  const correct = Number(stats?.correct || 0);
  const total = Number(stats?.total || 0);
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  const response: StatsResponse = {
    cardsStudied: Number(stats?.cards_studied || 0),
    accuracy,
    streak: Number(stats?.streak || 0),
  };

  // Add cache headers for better performance (60 seconds)
  res.set('Cache-Control', 'private, max-age=60');

  return res.json(response);
}, 'GET /api/stats'));

export default router;

