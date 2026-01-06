/**
 * Card routes
 */
import { Router } from 'express';
import { sql } from '../config/database.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { withErrorHandler, ApiError } from '../middleware/error.js';

const router = Router();

/**
 * GET /api/decks/:deckId/cards
 * Get all cards in a deck
 */
router.get('/decks/:deckId/cards', withErrorHandler(async (req, res) => {
  const { deckId } = req.params;

  const rows = await sql`
    SELECT 
      id,
      deck_id,
      question,
      answer,
      question as prompt_es,
      answer as translation_en,
      audio_url,
      image_url,
      created_at,
      updated_at
    FROM cards
    WHERE deck_id = ${deckId}
    ORDER BY created_at ASC
  `;

  return res.json(rows);
}, 'GET /api/decks/:deckId/cards'));

/**
 * POST /api/decks/:deckId/cards
 * Create a card in a deck
 */
router.post('/decks/:deckId/cards', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const { deckId } = req.params;
  const body = req.body;
  const {
    prompt_es,
    answer_es,
    distractor_1_es,
    distractor_2_es,
    distractor_3_es,
    notes,
    translation_en,
  } = body;

  const trimmedPrompt = (prompt_es || "").trim();
  const trimmedTranslation = (translation_en || "").trim();

  if (!trimmedPrompt || !trimmedTranslation) {
    throw new ApiError(400, "Spanish prompt and English meaning are required.");
  }

  // Check user plan and card limit
  const userRows = await sql`
    SELECT u.plan 
    FROM users u
    JOIN decks d ON (
      (d.owner_id IS NOT NULL AND d.owner_id = u.id)
      OR (d.owner_user_id IS NOT NULL AND d.owner_user_id::text = u.id::text)
    )
    WHERE d.id = ${deckId} AND u.email = ${req.session!.user.email}
    LIMIT 1
  `;

  if (userRows.length > 0 && userRows[0].plan === "free") {
    const cardCountRows = await sql`
      SELECT COUNT(*) as count FROM cards WHERE deck_id = ${deckId}
    `;
    const cardCount = parseInt(cardCountRows[0].count);

    if (cardCount >= 20) {
      return res.status(403).json({
        error: "Free accounts are limited to 20 cards per set. Upgrade to Premium for unlimited cards.",
        limit_exceeded: true,
        limit_type: "cards",
      });
    }
  }

  const question = trimmedPrompt;
  const answer = trimmedTranslation;

  const rows = await sql`
    INSERT INTO cards (deck_id, question, answer)
    VALUES (${deckId}, ${question}, ${answer})
    RETURNING *
  `;

  return res.json(rows[0]);
}, 'POST /api/decks/:deckId/cards'));

/**
 * POST /api/decks/:deckId/cards/bulk
 * Create multiple cards in a deck
 */
router.post('/decks/:deckId/cards/bulk', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const { deckId } = req.params;
  const { cards } = req.body;

  if (!cards || !Array.isArray(cards) || cards.length === 0) {
    throw new ApiError(400, "Cards array is required");
  }

  // Check user plan and card limit
  const userRows = await sql`
    SELECT u.plan 
    FROM users u
    JOIN decks d ON (
      (d.owner_id IS NOT NULL AND d.owner_id = u.id)
      OR (d.owner_user_id IS NOT NULL AND d.owner_user_id::text = u.id::text)
    )
    WHERE d.id = ${deckId} AND u.email = ${req.session!.user.email}
    LIMIT 1
  `;

  if (userRows.length > 0 && userRows[0].plan === "free") {
    const cardCountRows = await sql`
      SELECT COUNT(*) as count FROM cards WHERE deck_id = ${deckId}
    `;
    const currentCardCount = parseInt(cardCountRows[0].count);
    const newTotalCards = currentCardCount + cards.length;

    if (newTotalCards > 20) {
      const remainingSlots = Math.max(0, 20 - currentCardCount);
      
      // If this is the first batch of cards (deck is empty), delete the deck
      if (currentCardCount === 0) {
        await sql`DELETE FROM decks WHERE id = ${deckId}`;
      }
      
      return res.status(403).json({
        error: `Free accounts are limited to 20 cards per set. You can add ${remainingSlots} more card(s). Upgrade to Premium for unlimited cards.`,
        limit_exceeded: true,
        limit_type: "cards",
        current_count: currentCardCount,
        max_allowed: 20,
        remaining_slots: remainingSlots,
        deck_deleted: currentCardCount === 0,
      });
    }
  }

  // Map incoming fields to existing schema
  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIndex = 1;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const question = (card.prompt_es || card.question || "").trim();
    const answer = (card.translation_en || card.answer_es || card.answer || "").trim();

    if (!question || !answer) {
      throw new ApiError(400, `Each card needs a Spanish prompt and an English meaning (issue on line ${i + 1}).`);
    }

    placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
    values.push(deckId, question, answer);
    paramIndex += 3;
  }

  const query = `
    INSERT INTO cards (deck_id, question, answer)
    VALUES ${placeholders.join(", ")}
    RETURNING *
  `;

  const result = await sql(query, values);

  return res.json({ cards: result, count: result.length });
}, 'POST /api/decks/:deckId/cards/bulk'));

/**
 * GET /api/cards/:id
 * Get card by ID
 */
router.get('/:id', withErrorHandler(async (req, res) => {
  const { id } = req.params;

  const rows = await sql`
    SELECT * FROM cards WHERE id = ${id} LIMIT 1
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

  const rows = await sql`
    UPDATE cards
    SET 
      question = COALESCE(${prompt_es}, question),
      answer = COALESCE(${translation_en || answer_es}, answer),
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

