/**
 * Authentication middleware for Express routes
 */
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sql } from '../config/database.js';
import { config } from '../config/env.js';
import { ApiError } from './error.js';

export interface AuthSession {
  user: {
    id: string; // User ID from database
    email: string;
    name?: string;
    image?: string;
  };
  expires: string;
}

export interface AuthRequest extends Request {
  session?: AuthSession;
  user?: any;
}

/**
 * Extract and verify JWT token from request cookies.
 * Returns the decoded payload and the matching database user row.
 */
async function verifyTokenAndGetUser(req: AuthRequest) {
  const token = req.cookies?.['authjs.session-token'] || 
                req.cookies?.['__Secure-authjs.session-token'];

  if (!token) {
    throw new ApiError(401, 'Not authenticated');
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, config.AUTH_SECRET);
  } catch {
    throw new ApiError(401, 'Invalid token');
  }

  const userRows = await sql`
    SELECT id, email, display_name, role
    FROM users
    WHERE id = ${decoded.userId}
    LIMIT 1
  `;

  if (userRows.length === 0) {
    throw new ApiError(401, 'User not found');
  }

  return { decoded, user: userRows[0] };
}

/**
 * Build an AuthSession object from a decoded JWT and a user row.
 */
function buildSession(decoded: any, user: any): AuthSession {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.display_name,
    },
    expires: new Date(decoded.exp * 1000).toISOString(),
  };
}

/**
 * Middleware to require authentication
 */
export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { decoded, user } = await verifyTokenAndGetUser(req);
    req.session = buildSession(decoded, user);
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

/**
 * Middleware to require admin role
 */
export const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { decoded, user } = await verifyTokenAndGetUser(req);

    if (user.role !== 'admin') {
      throw new ApiError(403, 'Access denied');
    }

    req.session = buildSession(decoded, user);
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(403).json({ error: 'Access denied' });
  }
};

/**
 * Utility to get current user from database
 */
export async function getCurrentUser(session: AuthSession) {
  const userRows = await sql`
    SELECT id, email, display_name, role, preferred_locale, preferred_voice_gender, tts_voice_id, is_premium, plan, has_seen_welcome
    FROM users
    WHERE id = ${session.user.id}
    LIMIT 1
  `;

  if (userRows.length === 0) {
    throw new ApiError(404, 'User not found');
  }

  const user = userRows[0];
  
  // Admin users are always premium
  if (user.role === 'admin') {
    user.is_premium = true;
    user.plan = 'premium';
  }
  
  return user;
}

/**
 * Utility to get current user or return 401
 */
export async function getCurrentUserOr401(req: any) {
  try {
    const { user } = await verifyTokenAndGetUser(req);

    // Fetch extended fields needed by play-sessions and other consumers
    const rows = await sql`
      SELECT id, email, plan, role, is_premium, display_name
      FROM users
      WHERE id = ${user.id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return { error: { status: 404, body: { error: "User not found" } } };
    }

    return { user: rows[0] };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: { status: error.statusCode, body: { error: error.message } } };
    }
    return { error: { status: 401, body: { error: "Authentication failed" } } };
  }
}

