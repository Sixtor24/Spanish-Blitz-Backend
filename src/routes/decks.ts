/**
 * Deck routes
 */
import { Router } from 'express';
import { sql } from '../config/database.js';
import { requireAuth, getCurrentUser, type AuthRequest } from '../middleware/auth.js';
import { withErrorHandler, ApiError } from '../middleware/error.js';
import type { CreateDeckBody, UpdateDeckBody } from '../types/api.types.js';

const router = Router();

/**
 * Ensure deck columns exist
 */
async function ensureDeckColumns() {
  await sql`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE decks ADD COLUMN IF NOT EXISTS title text;
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        ALTER TABLE decks ADD COLUMN IF NOT EXISTS name text;
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        ALTER TABLE decks ADD COLUMN IF NOT EXISTS description text;
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        ALTER TABLE decks ADD COLUMN IF NOT EXISTS owner_user_id integer;
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        ALTER TABLE decks ALTER COLUMN owner_user_id TYPE text USING owner_user_id::text;
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        ALTER TABLE decks ADD COLUMN IF NOT EXISTS owner_id uuid;
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        ALTER TABLE decks ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT false;
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        ALTER TABLE decks ADD COLUMN IF NOT EXISTS primary_color_hex text;
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        ALTER TABLE decks ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW();
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        ALTER TABLE decks ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();
      EXCEPTION WHEN others THEN NULL; END;
    END$$;
  `;
}

/**
 * GET /api/decks
 * List decks
 */
router.get('/', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = user.id;
  const userIdText = String(userId);

  const { search, filter } = req.query;

  await ensureDeckColumns();

  let query = `
    SELECT 
      d.id,
      d.title,
      d.description,
      d.owner_user_id,
      d.is_public,
      d.primary_color_hex,
      d.created_at,
      d.updated_at,
      COUNT(c.id) as card_count
    FROM decks d
    LEFT JOIN cards c ON c.deck_id = d.id
    WHERE 1=1
  `;

  const params: any[] = [];
  let paramIndex = 1;

  // Apply filter
  if (filter === "owned") {
    query += ` AND d.owner_user_id = $${paramIndex}`;
    params.push(userIdText);
    paramIndex++;
  } else if (filter === "assigned") {
    query += ` AND EXISTS (
      SELECT 1 FROM user_decks ud 
      WHERE ud.deck_id = d.id AND ud.user_id = $${paramIndex}
    )`;
    params.push(userId);
    paramIndex++;
  } else if (filter === "public") {
    query += ` AND d.is_public = true`;
  }

  // Apply search
  if (search && typeof search === 'string') {
    query += ` AND (
      LOWER(d.title) LIKE LOWER($${paramIndex})
      OR LOWER(d.description) LIKE LOWER($${paramIndex})
    )`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  query += ` GROUP BY d.id ORDER BY d.created_at DESC`;

  let rows;
  try {
    rows = await sql(query, params);
  } catch (err: any) {
    const message = (err?.message || "").toLowerCase();
    if (message.includes("primary_color_hex") && message.includes("column")) {
      const fallback = query.replace(/,\s*d\.primary_color_hex,/i, ",").replace(/d\.primary_color_hex,?/gi, "");
      rows = await sql(fallback, params);
    } else {
      throw err;
    }
  }

  return res.json(rows);
}, 'GET /api/decks'));

/**
 * POST /api/decks
 * Create deck
 */
router.post('/', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = user.id;
  const userIdText = String(userId);

  const body = req.body as CreateDeckBody & { name?: string };
  const { title, name: incomingName, description, is_public, primary_color_hex } = body;

  const name = title || incomingName;
  if (!name) {
    throw new ApiError(400, "Title is required");
  }

  await ensureDeckColumns();

  const userPlan = user.plan;

  // Check deck limit for free users
  if (userPlan === "free") {
    const deckCountRows = await sql`
      SELECT COUNT(*) as count FROM decks WHERE owner_user_id = ${userIdText}
    `;
    const deckCount = parseInt(deckCountRows[0].count);

    if (deckCount >= 3) {
      throw new ApiError(403, "Free accounts can create up to 3 sets. Upgrade to Premium to create unlimited sets.");
    }
  }

  let rows;
  try {
    rows = await sql`
      INSERT INTO decks (name, title, description, owner_user_id, owner_id, is_public, primary_color_hex)
      VALUES (${name}, ${title || name}, ${description}, ${userIdText}, ${userId}, ${is_public || false}, ${primary_color_hex || null})
      RETURNING *
    `;
  } catch (err: any) {
    const message = (err?.message || "").toLowerCase();
    if (message.includes("primary_color_hex") && message.includes("column")) {
      await ensureDeckColumns();
      rows = await sql`
        INSERT INTO decks (name, title, description, owner_user_id, owner_id, is_public)
        VALUES (${name}, ${title || name}, ${description}, ${userIdText}, ${userId}, ${is_public || false})
        RETURNING *
      `;
    } else if (message.includes("title") && message.includes("column")) {
      await ensureDeckColumns();
      rows = await sql`
        INSERT INTO decks (name, title, description, owner_user_id, owner_id, is_public, primary_color_hex)
        VALUES (${name}, ${title || name}, ${description}, ${userIdText}, ${userId}, ${is_public || false}, ${primary_color_hex || null})
        RETURNING *
      `;
    } else {
      throw err;
    }
  }

  return res.json(rows[0]);
}, 'POST /api/decks'));

/**
 * GET /api/decks/:id
 * Get deck by ID
 */
router.get('/:id', withErrorHandler(async (req, res) => {
  const { id } = req.params;

  await ensureDeckColumns();

  const rows = await sql`
    SELECT 
      d.*,
      COUNT(c.id) as card_count
    FROM decks d
    LEFT JOIN cards c ON c.deck_id = d.id
    WHERE d.id = ${id}
    GROUP BY d.id
  `;

  if (rows.length === 0) {
    throw new ApiError(404, "Deck not found");
  }

  return res.json(rows[0]);
}, 'GET /api/decks/:id'));

/**
 * PATCH /api/decks/:id
 * Update deck
 */
router.patch('/:id', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const { id } = req.params;
  const body = req.body as UpdateDeckBody;
  const { title, description, is_public, primary_color_hex } = body;

  await ensureDeckColumns();

  let rows;
  try {
    rows = await sql`
      UPDATE decks
      SET 
        title = COALESCE(${title}, title),
        description = COALESCE(${description}, description),
        is_public = COALESCE(${is_public}, is_public),
        primary_color_hex = COALESCE(${primary_color_hex}, primary_color_hex),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
  } catch (err: any) {
    const message = (err?.message || "").toLowerCase();
    if (message.includes("primary_color_hex") && message.includes("column")) {
      rows = await sql`
        UPDATE decks
        SET 
          title = COALESCE(${title}, title),
          description = COALESCE(${description}, description),
          is_public = COALESCE(${is_public}, is_public),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
    } else {
      throw err;
    }
  }

  if (rows.length === 0) {
    throw new ApiError(404, "Deck not found");
  }

  return res.json(rows[0]);
}, 'PATCH /api/decks/:id'));

/**
 * DELETE /api/decks/:id
 * Delete deck
 */
router.delete('/:id', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const { id } = req.params;

  await sql`DELETE FROM decks WHERE id = ${id}`;

  return res.json({ success: true });
}, 'DELETE /api/decks/:id'));

/**
 * GET /api/decks/:deckId/cards
 * Get all cards in a deck
 */
router.get('/:deckId/cards', withErrorHandler(async (req, res) => {
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
router.post('/:deckId/cards', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
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
router.post('/:deckId/cards/bulk', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
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
      return res.status(403).json({
        error: `Free accounts are limited to 20 cards per set. You can add ${remainingSlots} more card(s). Upgrade to Premium for unlimited cards.`,
        limit_exceeded: true,
        limit_type: "cards",
        current_count: currentCardCount,
        max_allowed: 20,
        remaining_slots: remainingSlots,
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

export default router;

