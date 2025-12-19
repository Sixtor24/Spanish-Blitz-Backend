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

export default router;

