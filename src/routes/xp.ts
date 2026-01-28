/**
 * XP (Experience Points) routes
 * Handles XP awards for different game modes
 */
import { Router, type Router as ExpressRouter } from 'express';
import { sql } from '../config/database.js';
import { requireAuth, getCurrentUser, type AuthRequest } from '../middleware/auth.js';
import { withErrorHandler, ApiError } from '../middleware/error.js';
import { broadcastSessionRefresh } from '../services/ws-hub.js';

const router: ExpressRouter = Router();

/**
 * Helper: Update XP progress for assignments with xp_goal
 * Called whenever a user earns XP
 */
async function updateAssignmentXpProgress(userId: string, xpEarned: number) {
  try {
    console.log(`🎯 [XP Progress] Checking assignments for user ${userId}, XP earned: ${xpEarned}`);
    
    // Get all active assignments with xp_goal for this user
    // Include BOTH: specific assignments (in assignment_students) AND "All students" assignments
    const assignments = await sql`
      SELECT DISTINCT
        a.id as assignment_id,
        a.classroom_id,
        a.title,
        a.xp_goal,
        a.xp_reward,
        asub.xp_earned_since_assignment,
        asub.completed_at,
        CASE 
          WHEN EXISTS (SELECT 1 FROM assignment_students WHERE assignment_id = a.id) THEN 'specific'
          ELSE 'all_students'
        END as assignment_type
      FROM assignments a
      JOIN classroom_memberships cm ON cm.classroom_id = a.classroom_id AND cm.student_id = ${userId} AND cm.is_active = true
      LEFT JOIN assignment_students astud ON astud.assignment_id = a.id
      LEFT JOIN assignment_submissions asub ON asub.assignment_id = a.id AND asub.student_id = ${userId}
      WHERE a.xp_goal IS NOT NULL
        AND a.xp_goal > 0
        AND (asub.completed_at IS NULL OR asub.xp_earned_since_assignment < a.xp_goal)
        AND (
          astud.student_id = ${userId}
          OR NOT EXISTS (SELECT 1 FROM assignment_students WHERE assignment_id = a.id)
        )
    `;

    console.log(`📊 [XP Progress] Found ${assignments.length} active XP goal assignments for user`);
    
    if (assignments.length === 0) {
      console.log(`⚠️ [XP Progress] No active XP goal assignments found. Checking why...`);
      
      // Debug: Check if user is in any classroom
      const classrooms = await sql`
        SELECT classroom_id, is_active FROM classroom_memberships WHERE student_id = ${userId}
      `;
      console.log(`📚 [XP Progress] User is in ${classrooms.length} classrooms:`, classrooms);
      
      // Debug: Check all assignments with xp_goal
      const allXpAssignments = await sql`
        SELECT id, title, classroom_id, xp_goal FROM assignments WHERE xp_goal IS NOT NULL AND xp_goal > 0
      `;
      console.log(`📝 [XP Progress] All XP goal assignments in system:`, allXpAssignments);
    }

    for (const assignment of assignments) {
      console.log(`\n🔄 [XP Progress] Processing assignment "${assignment.title}" (${assignment.assignment_type})`);
      console.log(`   - Assignment ID: ${assignment.assignment_id}`);
      console.log(`   - XP Goal: ${assignment.xp_goal}`);
      console.log(`   - Current Progress: ${assignment.xp_earned_since_assignment || 0}`);
      console.log(`   - XP to add: ${xpEarned}`);
      
      const newXpProgress = (assignment.xp_earned_since_assignment || 0) + xpEarned;
      const isNowCompleted = newXpProgress >= assignment.xp_goal;

      console.log(`   - New XP Progress: ${newXpProgress}/${assignment.xp_goal}`);
      console.log(`   - Completed: ${isNowCompleted ? 'YES' : 'NO'}`);

      // Update or insert submission
      const completedTimestamp = isNowCompleted ? new Date() : null;
      const result = await sql`
        INSERT INTO assignment_submissions (
          assignment_id, 
          student_id, 
          xp_earned_since_assignment,
          completed_at
        )
        VALUES (
          ${assignment.assignment_id},
          ${userId},
          ${newXpProgress},
          ${completedTimestamp}
        )
        ON CONFLICT (assignment_id, student_id)
        DO UPDATE SET
          xp_earned_since_assignment = assignment_submissions.xp_earned_since_assignment + ${xpEarned},
          completed_at = CASE 
            WHEN assignment_submissions.xp_earned_since_assignment + ${xpEarned} >= ${assignment.xp_goal} 
            AND assignment_submissions.completed_at IS NULL
            THEN ${new Date()}
            ELSE assignment_submissions.completed_at
          END
        RETURNING xp_earned_since_assignment, completed_at
      `;

      console.log(`   ✅ Updated submission:`, result[0]);

      // Award xp_reward if just completed
      if (isNowCompleted && !assignment.completed_at && assignment.xp_reward && assignment.xp_reward > 0) {
        // Insert XP event for assignment reward
        await sql`
          INSERT INTO xp_events (user_id, mode, xp_earned, assignment_id)
          VALUES (${userId}, 'assignment', ${assignment.xp_reward}, ${assignment.assignment_id})
          ON CONFLICT DO NOTHING
        `;

        // Update user's total XP
        await sql`
          UPDATE users
          SET xp_total = xp_total + ${assignment.xp_reward}
          WHERE id = ${userId}
        `;

        console.log(`🎉 Assignment XP Goal completed! Awarded ${assignment.xp_reward} XP bonus to user ${userId}`);
      }
    }
    
    console.log(`✅ [XP Progress] Finished processing all assignments\n`);
  } catch (error) {
    console.error('❌ [XP Progress] Error updating assignment XP progress:', error);
    // Don't throw - this is a background operation
  }
}

/**
 * Calculate XP for Blitz Challenge based on rank
 */
function xpForRank(rank: number, participated: boolean): number {
  if (!participated) return 0;
  if (rank === 1) return 10;
  if (rank === 2) return 5;
  if (rank === 3) return 4;
  if (rank === 4) return 3;
  if (rank === 5) return 2;
  return 1; // All other participants
}

/**
 * POST /api/xp/solo-blitz/complete
 * Award XP for completing a Solo Blitz session
 */
router.post('/solo-blitz/complete', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { setId, sessionId, correctAnswers } = req.body;

  if (typeof correctAnswers !== 'number' || correctAnswers < 0) {
    throw new ApiError(400, 'Invalid correctAnswers value');
  }

  const xpEarned = Math.max(0, Math.floor(correctAnswers));

  try {
    // Insert XP event
    await sql`
      INSERT INTO xp_events (user_id, mode, xp_earned, set_id, session_id)
      VALUES (${userId}, 'solo_blitz', ${xpEarned}, ${setId || null}, ${sessionId || null})
    `;

    // Update user's total XP
    const rows = await sql`
      UPDATE users
      SET xp_total = xp_total + ${xpEarned}
      WHERE id = ${userId}
      RETURNING xp_total
    `;

    // Update assignment XP progress if applicable
    if (xpEarned > 0) {
      await updateAssignmentXpProgress(userId, xpEarned);
    }

    return res.json({
      xpEarned,
      xpTotal: rows[0]?.xp_total || xpEarned,
    });
  } catch (error) {
    console.error('Error awarding Solo Blitz XP:', error);
    throw new ApiError(500, 'Failed to award XP');
  }
}, 'POST /api/xp/solo-blitz/complete'));

/**
 * POST /api/xp/blitz-challenge/finalize
 * Award XP for all players in a completed Blitz Challenge based on their ranking
 */
router.post('/blitz-challenge/finalize', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const { challengeId, results } = req.body;

  if (!challengeId || !Array.isArray(results)) {
    throw new ApiError(400, 'challengeId and results array are required');
  }

  try {
    // Verify the session exists and check permissions
    const sessionRows = await sql`
      SELECT id, host_user_id, status, is_finalized
      FROM play_sessions
      WHERE id = ${challengeId}
      LIMIT 1
    `;

    if (sessionRows.length === 0) {
      throw new ApiError(404, 'Challenge not found');
    }

    const session = sessionRows[0];

    // Only host or admin can finalize
    if (session.host_user_id !== user.id && user.role !== 'admin') {
      throw new ApiError(403, 'Only host or admin can finalize the challenge');
    }

    // Check if already finalized
    if (session.is_finalized) {
      return res.status(409).json({
        error: 'Challenge already finalized',
        challengeId,
      });
    }

    const payouts: Array<{ userId: string; rank: number; xpEarned: number }> = [];

    // Mark session as finalized
    await sql`
      UPDATE play_sessions
      SET is_finalized = TRUE
      WHERE id = ${challengeId}
    `;

    // Process each player
    for (const result of results) {
      const { userId, rank, participated } = result;

      if (!userId) continue;

      const xpEarned = xpForRank(rank, participated);

      // Only insert XP event if XP > 0
      if (xpEarned > 0) {
        try {
          // Insert XP event (ON CONFLICT DO NOTHING handles unique constraint)
          await sql`
            INSERT INTO xp_events (user_id, mode, xp_earned, challenge_id)
            VALUES (${userId}, 'blitz_challenge', ${xpEarned}, ${challengeId})
            ON CONFLICT (user_id, mode, challenge_id) DO NOTHING
          `;

          // Update user's total XP
          await sql`
            UPDATE users
            SET xp_total = xp_total + ${xpEarned}
            WHERE id = ${userId}
          `;
        } catch (err) {
          console.error(`Error awarding XP to user ${userId}:`, err);
        }
      }

      payouts.push({ userId, rank, xpEarned });

      // Update assignment XP progress if applicable
      if (xpEarned > 0) {
        await updateAssignmentXpProgress(userId, xpEarned);
      }
    }

    // Broadcast to all connected clients to refresh the session
    // This will update all players with the XP results
    broadcastSessionRefresh(challengeId);

    return res.json({
      challengeId,
      payouts,
      message: 'XP awarded successfully',
    });
  } catch (error: any) {
    console.error('Error finalizing Blitz Challenge XP:', error);
    
    // If it's already our ApiError, rethrow it
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(500, 'Failed to finalize challenge XP');
  }
}, 'POST /api/xp/blitz-challenge/finalize'));

/**
 * GET /api/xp/leaderboard
 * Get top users by XP (optional, for future use)
 */
router.get('/leaderboard', withErrorHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 100);

  const rows = await sql`
    SELECT 
      id,
      display_name,
      xp_total,
      role
    FROM users
    WHERE xp_total > 0
    ORDER BY xp_total DESC
    LIMIT ${limit}
  `;

  return res.json(rows);
}, 'GET /api/xp/leaderboard'));

/**
 * GET /api/xp/history
 * Get XP history for current user
 */
router.get('/history', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const rows = await sql`
    SELECT 
      id,
      mode,
      xp_earned,
      set_id,
      challenge_id,
      assignment_id,
      created_at
    FROM xp_events
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return res.json(rows);
}, 'GET /api/xp/history'));

export default router;
