import { Router, type Request, type Response } from 'express';
import { hash, verify } from 'argon2';
import jwt from 'jsonwebtoken';
import { sql } from '../config/database.js';
import { config } from '../config/env.js';

const router = Router();

// Sign In
router.post('/signin', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Get user from database
    const userRows = await sql`
      SELECT id, email, password_hash, role, display_name
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (userRows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = userRows[0];

    // Verify password
    const isValid = await verify(user.password_hash, password);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Create session token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.AUTH_SECRET,
      { expiresIn: '7d' }
    );

    // Set cookie
    res.cookie('authjs.session-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        display_name: user.display_name,
      },
    });
  } catch (error) {
    console.error('Sign in error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Sign Up
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Check if user already exists
    const existingUser = await sql`
      SELECT id FROM users WHERE email = ${email} LIMIT 1
    `;

    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash password
    const password_hash = await hash(password);

    // Create user
    const newUserRows = await sql`
      INSERT INTO users (email, password_hash, display_name, role)
      VALUES (${email}, ${password_hash}, ${name || email}, 'user')
      RETURNING id, email, display_name, role
    `;

    const user = newUserRows[0];

    // Create session token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.AUTH_SECRET,
      { expiresIn: '7d' }
    );

    // Set cookie
    res.cookie('authjs.session-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        display_name: user.display_name,
      },
    });
  } catch (error) {
    console.error('Sign up error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Sign Out
router.post('/signout', async (req: Request, res: Response) => {
  res.clearCookie('authjs.session-token');
  res.clearCookie('__Secure-authjs.session-token');
  res.json({ message: 'Signed out successfully' });
});

// Forgot Password (existing route)
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const userRows = await sql`
      SELECT id, email FROM users WHERE email = ${email} LIMIT 1
    `;

    // Always return success to prevent email enumeration
    res.json({ message: 'If the email exists, a password reset link has been sent' });

    if (userRows.length === 0) {
      return;
    }

    // TODO: Implement actual password reset email logic
    console.log(`Password reset requested for: ${email}`);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
