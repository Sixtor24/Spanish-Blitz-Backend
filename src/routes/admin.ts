/**
 * Admin routes
 */
import { Router } from 'express';
import { sql } from '../config/database.js';
import { requireAdmin, getCurrentUser, type AuthRequest } from '../middleware/auth.js';
import { withErrorHandler, ApiError } from '../middleware/error.js';
import { sendEmail, premiumActivatedTemplate } from '../services/email.js';
import type { UpdateUserAdminBody } from '../types/api.types.js';

const router = Router();

/**
 * GET /api/admin/users
 * Get all users (admin only)
 */
router.get('/users', requireAdmin, withErrorHandler(async (req: AuthRequest, res) => {
  const { search, role: roleFilter, plan: planFilter } = req.query;

  let query = `
    SELECT 
      u.id,
      u.email,
      u.display_name,
      u.role,
      u.is_premium,
      u.plan,
      u.created_at,
      u.updated_at
    FROM users u
    WHERE 1=1
  `;

  const params: any[] = [];
  let paramIndex = 1;

  // Apply search
  if (search && typeof search === 'string') {
    query += ` AND (
      LOWER(u.email) LIKE LOWER($${paramIndex})
      OR LOWER(u.display_name) LIKE LOWER($${paramIndex})
    )`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  // Apply role filter
  if (roleFilter && typeof roleFilter === 'string' && roleFilter !== "all") {
    query += ` AND u.role = $${paramIndex}`;
    params.push(roleFilter);
    paramIndex++;
  }

  // Apply plan filter
  if (planFilter && typeof planFilter === 'string' && planFilter !== "all") {
    query += ` AND u.plan = $${paramIndex}`;
    params.push(planFilter);
    paramIndex++;
  }

  query += ` ORDER BY u.created_at DESC`;

  const rows = await sql(query, params);

  return res.json(rows);
}, 'GET /api/admin/users'));

/**
 * GET /api/admin/users/:id
 * Get user by ID (admin only)
 */
router.get('/users/:id', requireAdmin, withErrorHandler(async (req: AuthRequest, res) => {
  const { id } = req.params;

  const rows = await sql`
    SELECT id, email, display_name, role, is_premium, plan, created_at, updated_at
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new ApiError(404, 'User not found');
  }

  return res.json(rows[0]);
}, 'GET /api/admin/users/:id'));

/**
 * PATCH /api/admin/users/:id
 * Update user role and premium status (admin only)
 */
router.patch('/users/:id', requireAdmin, withErrorHandler(async (req: AuthRequest, res) => {
  const { id } = req.params;
  const body = req.body as UpdateUserAdminBody;
  const { role, is_premium, plan } = body;

  // Get current admin user
  const currentAdmin = await getCurrentUser(req.session!);
  const currentAdminId = currentAdmin.id;

  const targetRows = await sql`
    SELECT id, email, display_name, role, is_premium, plan
    FROM users WHERE id = ${id} LIMIT 1
  `;

  if (targetRows.length === 0) {
    throw new ApiError(404, 'User not found');
  }

  const previous = targetRows[0];

  // Prevent admin from removing their own admin role
  if (id === currentAdminId && role && role !== "admin") {
    throw new ApiError(400, 'You cannot remove your own admin role');
  }

  // Build update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (role !== undefined) {
    updates.push(`role = $${paramIndex}`);
    values.push(role);
    paramIndex++;
  }

  // If plan provided, normalize is_premium from plan; otherwise accept explicit is_premium toggle
  if (plan !== undefined) {
    const premiumFlag = plan === "premium";
    updates.push(`plan = $${paramIndex}`);
    values.push(plan);
    paramIndex++;
    updates.push(`is_premium = $${paramIndex}`);
    values.push(premiumFlag);
    paramIndex++;
  } else if (is_premium !== undefined) {
    updates.push(`is_premium = $${paramIndex}`);
    values.push(is_premium);
    paramIndex++;

    // keep plan in sync when only is_premium is toggled
    updates.push(`plan = $${paramIndex}`);
    values.push(is_premium ? "premium" : "free");
    paramIndex++;
  }

  if (updates.length === 0) {
    throw new ApiError(400, 'No updates provided');
  }

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const query = `
    UPDATE users
    SET ${updates.join(", ")}
    WHERE id = $${paramIndex}
    RETURNING id, email, display_name, role, is_premium, plan, created_at, updated_at
  `;

  const rows = await sql(query, values);

  if (rows.length === 0) {
    throw new ApiError(404, 'User not found');
  }

  const updated = rows[0];

  const becamePremium =
    (previous.plan !== "premium" || previous.is_premium !== true) &&
    (updated.plan === "premium" || updated.is_premium === true);

  if (becamePremium) {
    sendEmail({
      to: updated.email,
      subject: "¡Tu acceso Premium está activo!",
      html: premiumActivatedTemplate({ name: updated.display_name, email: updated.email }),
    });
  }

  return res.json(updated);
}, 'PATCH /api/admin/users/:id'));

/**
 * DELETE /api/admin/users/:id
 * Delete user (admin only)
 */
router.delete('/users/:id', requireAdmin, withErrorHandler(async (req: AuthRequest, res) => {
  const { id } = req.params;

  // Get current admin user
  const currentAdmin = await getCurrentUser(req.session!);
  const currentAdminId = currentAdmin.id;

  // Prevent admin from deleting themselves
  if (id === currentAdminId) {
    throw new ApiError(400, 'You cannot delete your own account');
  }

  const rows = await sql`
    DELETE FROM users
    WHERE id = ${id}
    RETURNING id
  `;

  if (rows.length === 0) {
    throw new ApiError(404, 'User not found');
  }

  return res.json({ success: true, id: rows[0].id });
}, 'DELETE /api/admin/users/:id'));

/**
 * POST /api/admin/setup-test-users
 * Setup test users for development
 */
router.post('/setup-test-users', requireAdmin, withErrorHandler(async (req: AuthRequest, res) => {
  // This would be implemented based on your specific test user needs
  // For now, return success
  return res.json({ success: true, message: 'Test users setup endpoint - implement as needed' });
}, 'POST /api/admin/setup-test-users'));

export default router;

