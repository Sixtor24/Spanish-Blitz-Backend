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
 * Middleware to require authentication
 */
export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get session token from cookie
    const token = req.cookies?.['authjs.session-token'] || 
                  req.cookies?.['__Secure-authjs.session-token'];

    if (!token) {
      throw new ApiError(401, 'Not authenticated');
    }

    // Verify JWT token
    let decoded: any;
    try {
      decoded = jwt.verify(token, config.AUTH_SECRET);
    } catch (err) {
      throw new ApiError(401, 'Invalid token');
    }

    // Get user from database
    const userRows = await sql`
      SELECT id, email, display_name, role
      FROM users
      WHERE id = ${decoded.userId}
      LIMIT 1
    `;

    if (userRows.length === 0) {
      throw new ApiError(401, 'User not found');
    }

    const user = userRows[0];
    req.session = {
      user: {
        id: user.id, // Include userId to avoid redundant queries
        email: user.email,
        name: user.display_name,
      },
      expires: new Date(decoded.exp * 1000).toISOString(),
    };
    
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
    // First check authentication
    const token = req.cookies?.['authjs.session-token'] || 
                  req.cookies?.['__Secure-authjs.session-token'];

    if (!token) {
      throw new ApiError(401, 'Not authenticated');
    }

    // Verify JWT token
    let decoded: any;
    try {
      decoded = jwt.verify(token, config.AUTH_SECRET);
    } catch (err) {
      throw new ApiError(401, 'Invalid token');
    }

    // Get user from database and check admin role
    const userRows = await sql`
      SELECT id, email, display_name, role
      FROM users
      WHERE id = ${decoded.userId}
      LIMIT 1
    `;

    if (userRows.length === 0) {
      throw new ApiError(401, 'User not found');
    }

    const user = userRows[0];

    if (user.role !== 'admin') {
      throw new ApiError(403, 'Access denied');
    }

    req.session = {
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
      },
      expires: new Date(decoded.exp * 1000).toISOString(),
    };

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
    SELECT id, email, display_name, role, preferred_locale, is_premium, plan, has_seen_welcome
    FROM users
    WHERE email = ${session.user.email}
    LIMIT 1
  `;

  if (userRows.length === 0) {
    throw new ApiError(404, 'User not found');
  }

  return userRows[0];
}

/**
 * Utility to get current user or return 401
 */
export async function getCurrentUserOr401(req: any) {
  const token = req.cookies?.['authjs.session-token'] || 
                req.cookies?.['__Secure-authjs.session-token'];
  
  if (!token) {
    return { error: { status: 401, body: { error: "Not authenticated" } } };
  }

  // Verify JWT token
  let decoded: any;
  try {
    decoded = jwt.verify(token, config.AUTH_SECRET);
  } catch (err) {
    return { error: { status: 401, body: { error: "Invalid token" } } };
  }

  // Get user from database
  const rows = await sql`
    SELECT id, email, plan, role, is_premium, display_name
    FROM users
    WHERE id = ${decoded.userId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return { error: { status: 404, body: { error: "User not found" } } };
  }

  return { user: rows[0] };
}

