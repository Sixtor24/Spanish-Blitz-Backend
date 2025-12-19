/**
 * Play Sessions routes (Blitz Challenges)
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { sql } from '../config/database.js';
import { getCurrentUserOr401 } from '../middleware/auth.js';
import { withErrorHandler, ApiError } from '../middleware/error.js';
import { broadcastSessionRefresh } from '../services/ws-hub.js';

const router = Router();

const CODE_LENGTH = 6;
const genCode = () => nanoid(CODE_LENGTH).toUpperCase();

/**
 * Build session state for response
 */
async function buildState(sessionId: string | number, currentUserId: string) {
  const [sessionRows, playerRows, questionRows, answerRows] = await Promise.all([
    sql`SELECT ps.id, ps.code, ps.is_teacher, ps.host_user_id, ps.question_count, ps.time_limit_seconds, ps.status, ps.started_at, ps.ends_at, d.title as deck_title
        FROM play_sessions ps
        JOIN decks d ON d.id = ps.deck_id
        WHERE ps.id = ${sessionId}
        LIMIT 1`,
    sql`
      SELECT p.id, p.user_id, p.score, p.state, p.is_host, u.display_name, u.email,
        (SELECT count(*)::int FROM play_session_answers a WHERE a.player_id = p.id) AS answered_count
      FROM play_session_players p
      JOIN users u ON u.id = p.user_id
      WHERE p.session_id = ${sessionId}
    `,
    sql`
      SELECT q.id, q.card_id, q.position,
        c.question, c.answer, c.type,
        c.answer AS translation_en,
        c.question AS prompt_es,
        c.question AS answer_es
      FROM play_session_questions q
      JOIN cards c ON c.id = q.card_id
      WHERE q.session_id = ${sessionId}
      ORDER BY q.position ASC
    `,
    sql`SELECT a.id, a.player_id, a.question_id, a.is_correct, a.points_awarded FROM play_session_answers a WHERE a.session_id = ${sessionId} AND a.player_id = (SELECT id FROM play_session_players WHERE session_id = ${sessionId} AND user_id = ${currentUserId} LIMIT 1)`
  ]);

  const session = sessionRows[0];
  const isTeacherHost = session?.is_teacher && session?.host_user_id === currentUserId;
  const totalQuestions = questionRows.length;

  const sanitizedQuestions = isTeacherHost ? [] : questionRows;

  return {
    session,
    players: playerRows,
    questions: sanitizedQuestions,
    totalQuestions,
    currentPlayerAnswers: answerRows,
  };
}

/**
 * POST /api/play-sessions
 * Create a new play session
 */
router.post('/', withErrorHandler(async (req, res) => {
  const { user, error } = await getCurrentUserOr401(req);
  if (error) return res.status(error.status).json(error.body);

  // Only premium or admin can create sessions
  const canCreate = user.is_premium || user.plan === "premium" || user.role === "admin";
  if (!canCreate) {
    throw new ApiError(403, "Only premium users can create challenges");
  }

  const body = req.body;
  const deckId = body.deckId ?? body.deck_id;
  const rawTimeLimitMinutes = Number(body.timeLimitMinutes ?? body.time_limit_minutes ?? 0);
  const timeLimitMinutes = Number.isFinite(rawTimeLimitMinutes) ? Math.max(0, Math.min(rawTimeLimitMinutes, 60)) : 0;
  const questionCount = Math.max(1, Math.min(Number(body.questionCount ?? body.question_count ?? 10), 50));
  const isTeacher = Boolean(body.isTeacher ?? body.is_teacher);

  if (!deckId) {
    throw new ApiError(400, "deckId is required");
  }

  // Pick questions (random order, clamp to deck size)
  const cards = await sql`
    SELECT
      id,
      question,
      answer,
      type,
      answer AS translation_en,
      question AS prompt_es,
      answer AS answer_es
    FROM cards
    WHERE deck_id = ${deckId}
    ORDER BY random()
    LIMIT ${questionCount}
  `;

  if (cards.length === 0) {
    throw new ApiError(400, "Deck has no cards");
  }

  const finalQuestionCount = Math.min(questionCount, cards.length);
  const code = genCode();
  const timeLimitSeconds = timeLimitMinutes ? Number(timeLimitMinutes) * 60 : null;

  const selectedCards = cards.slice(0, finalQuestionCount);

  const sessionRows = await sql`
    INSERT INTO play_sessions (
      host_user_id,
      deck_id,
      mode,
      is_teacher,
      question_count,
      time_limit_seconds,
      status,
      started_at,
      ends_at,
      code
    ) VALUES (
      ${user.id},
      ${deckId},
      'blitz_challenge',
      ${isTeacher},
      ${finalQuestionCount},
      ${timeLimitSeconds},
      'pending',
      NULL,
      NULL,
      ${code}
    )
    RETURNING id, code, is_teacher, question_count, time_limit_seconds, ends_at
  `;

  const session = sessionRows[0];

  await sql`
    INSERT INTO play_session_players (session_id, user_id, is_host, state, score)
    VALUES (${session.id}, ${user.id}, true, ${isTeacher ? "finished" : "playing"}, 0)
    ON CONFLICT DO NOTHING
  `;

  await Promise.all(
    selectedCards.map((card, idx) =>
      sql`
        INSERT INTO play_session_questions (session_id, card_id, position, points_correct, points_incorrect)
        VALUES (${session.id}, ${card.id}, ${idx + 1}, 2, -1)
      `
    )
  );

  broadcastSessionRefresh(session.id);

  return res.json({
    sessionId: session.id,
    code: session.code,
    isTeacher,
    questionCount: session.question_count,
    timeLimitSeconds: session.time_limit_seconds,
    endsAt: session.ends_at,
  });
}, 'POST /api/play-sessions'));

/**
 * POST /api/play-sessions/join
 * Join a play session by code
 */
router.post('/join', withErrorHandler(async (req, res) => {
  const { user, error } = await getCurrentUserOr401(req);
  if (error) return res.status(error.status).json(error.body);

  const body = req.body;
  const code = (body.code ?? '').toUpperCase();
  
  if (!code) {
    throw new ApiError(400, 'Code is required');
  }

  const sessionRows = await sql`
    SELECT id, status, is_teacher, host_user_id
    FROM play_sessions
    WHERE code = ${code}
    LIMIT 1
  `;

  if (sessionRows.length === 0) {
    throw new ApiError(404, 'Session not found');
  }

  const session = sessionRows[0];
  
  if (session.status === 'completed' || session.status === 'cancelled') {
    throw new ApiError(400, 'Session is not active');
  }

  // enforce max 30 players
  const countRows = await sql`SELECT count(*)::int AS cnt FROM play_session_players WHERE session_id = ${session.id}`;
  if (countRows[0].cnt >= 30) {
    throw new ApiError(400, 'Session is full (max 30 players)');
  }

  // ensure player exists
  await sql`
    INSERT INTO play_session_players (session_id, user_id, is_host, state, score)
    VALUES (${session.id}, ${user.id}, ${session.host_user_id === user.id}, 'playing', 0)
    ON CONFLICT (session_id, user_id) DO NOTHING
  `;

  broadcastSessionRefresh(session.id);

  const state = await buildState(session.id, user.id);
  return res.json(state);
}, 'POST /api/play-sessions/join'));

/**
 * GET /api/play-sessions/:id/state
 * Get session state
 */
router.get('/:id/state', withErrorHandler(async (req, res) => {
  const { user, error } = await getCurrentUserOr401(req);
  if (error) return res.status(error.status).json(error.body);

  const sessionId = req.params.id;
  const sessionRows = await sql`SELECT id FROM play_sessions WHERE id = ${sessionId} LIMIT 1`;
  
  if (sessionRows.length === 0) {
    throw new ApiError(404, 'Session not found');
  }

  const state = await buildState(sessionId, user.id);
  return res.json(state);
}, 'GET /api/play-sessions/:id/state'));

/**
 * POST /api/play-sessions/:id/start
 * Start a play session
 */
router.post('/:id/start', withErrorHandler(async (req, res) => {
  const { user, error } = await getCurrentUserOr401(req);
  if (error) return res.status(error.status).json(error.body);

  const sessionId = req.params.id;
  const sessions = await sql`SELECT id, host_user_id, status, time_limit_seconds FROM play_sessions WHERE id = ${sessionId} LIMIT 1`;
  
  if (sessions.length === 0) {
    throw new ApiError(404, 'Session not found');
  }

  const session = sessions[0];

  if (session.host_user_id !== user.id && user.role !== 'admin') {
    throw new ApiError(403, 'Only host or admin can start the session');
  }

  if (session.status !== 'pending') {
    throw new ApiError(400, 'Session already started or finished');
  }

  const playerCountRows = await sql`SELECT count(*)::int AS cnt FROM play_session_players WHERE session_id = ${sessionId}`;
  if (playerCountRows[0].cnt < 2) {
    throw new ApiError(400, 'Need at least 2 players to start');
  }

  const startsAt = new Date();
  const endsAt = session.time_limit_seconds ? new Date(startsAt.getTime() + session.time_limit_seconds * 1000) : null;

  await sql`
    UPDATE play_sessions
    SET status = 'active', started_at = ${startsAt}, ends_at = ${endsAt}
    WHERE id = ${sessionId}
  `;

  broadcastSessionRefresh(sessionId);
  return res.json({ ok: true, started_at: startsAt, ends_at: endsAt });
}, 'POST /api/play-sessions/:id/start'));

/**
 * POST /api/play-sessions/:id/answer
 * Submit an answer to a question
 */
router.post('/:id/answer', withErrorHandler(async (req, res) => {
  const { user, error } = await getCurrentUserOr401(req);
  if (error) return res.status(error.status).json(error.body);

  const sessionId = req.params.id;
  const body = req.body;
  const questionId = body.questionId ?? body.question_id;
  const isCorrect = Boolean(body.isCorrect ?? body.is_correct);
  const answerText = body.answerText ?? null;

  if (!questionId) {
    throw new ApiError(400, 'questionId is required');
  }

  const sessionRows = await sql`SELECT id, is_teacher, host_user_id, status, ends_at FROM play_sessions WHERE id = ${sessionId} LIMIT 1`;
  
  if (sessionRows.length === 0) {
    throw new ApiError(404, 'Session not found');
  }

  const session = sessionRows[0];

  if (session.status === 'pending') {
    throw new ApiError(400, 'Session has not started yet');
  }

  if (session.status === 'completed' || session.status === 'cancelled') {
    throw new ApiError(400, 'Session is not active');
  }

  if (session.ends_at && new Date(session.ends_at).getTime() < Date.now()) {
    await sql`UPDATE play_sessions SET status = 'completed' WHERE id = ${sessionId}`;
    throw new ApiError(400, 'Session time is over');
  }

  const playerRows = await sql`SELECT id, is_host FROM play_session_players WHERE session_id = ${sessionId} AND user_id = ${user.id} LIMIT 1`;
  const player = playerRows[0];

  if (!player) {
    throw new ApiError(403, 'You are not in this session');
  }

  if (session.is_teacher && session.host_user_id === user.id) {
    throw new ApiError(400, 'Teacher/host cannot answer');
  }

  const pointsAwarded = isCorrect ? 2 : -1;

  const questionRows = await sql`SELECT id FROM play_session_questions WHERE id = ${questionId} AND session_id = ${sessionId} LIMIT 1`;
  
  if (questionRows.length === 0) {
    throw new ApiError(404, 'Question not found in this session');
  }

  const existing = await sql`SELECT id FROM play_session_answers WHERE question_id = ${questionId} AND player_id = ${player.id} LIMIT 1`;
  
  if (existing.length > 0) {
    throw new ApiError(400, 'Question already answered');
  }

  await sql`
    INSERT INTO play_session_answers (session_id, player_id, question_id, is_correct, points_awarded, answer_text)
    VALUES (${sessionId}, ${player.id}, ${questionId}, ${isCorrect}, ${pointsAwarded}, ${answerText})
  `;

  await sql`
    UPDATE play_session_players
    SET score = score + ${pointsAwarded}
    WHERE id = ${player.id}
  `;

  await sql`
    UPDATE play_session_players p
    SET state = 'finished'
    WHERE p.id = ${player.id}
      AND (SELECT count(*)::int FROM play_session_answers a WHERE a.player_id = p.id) >= (SELECT count(*)::int FROM play_session_questions q WHERE q.session_id = ${sessionId})
  `;

  const remaining = await sql`
    SELECT count(*)::int AS cnt
    FROM play_session_players
    WHERE session_id = ${sessionId}
      AND state = 'playing'
      AND (NOT (is_host = true AND ${session.is_teacher}))
  `;

  if (remaining[0].cnt === 0) {
    await sql`UPDATE play_sessions SET status = 'completed' WHERE id = ${sessionId}`;
  }

  broadcastSessionRefresh(sessionId);

  return res.json({ ok: true, points: pointsAwarded });
}, 'POST /api/play-sessions/:id/answer'));

export default router;

