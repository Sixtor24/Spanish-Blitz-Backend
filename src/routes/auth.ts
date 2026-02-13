import { Router, type Request, type Response } from 'express';
import { hash, verify } from 'argon2';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { sql } from '../config/database.js';
import { config } from '../config/env.js';
import { sendEmail, resetPasswordTemplate } from '../services/email.js';

const router = Router();

const SESSION_COOKIE_NAME = 'authjs.session-token';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Build cookie options for session cookies.
 * Centralised to avoid duplication across signin/signup/signout.
 */
function buildCookieOptions(): Record<string, any> {
  const isProduction = process.env.NODE_ENV === 'production';
  const opts: Record<string, any> = {
    httpOnly: true,
    secure: true,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  };
  if (isProduction) {
    opts.partitioned = true;
  }
  return opts;
}

// Sign In
router.post('/signin', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Get user from database (case-insensitive email)
    const emailLower = email.toLowerCase().trim();
    const userRows = await sql`
      SELECT id, email, password_hash, role, display_name
      FROM users
      WHERE LOWER(TRIM(email)) = ${emailLower}
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

    res.cookie(SESSION_COOKIE_NAME, token, buildCookieOptions());

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

    // Check if user already exists (case-insensitive email)
    const emailLower = email.toLowerCase().trim();
    const existingUser = await sql`
      SELECT id FROM users WHERE LOWER(TRIM(email)) = ${emailLower} LIMIT 1
    `;

    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash password
    const password_hash = await hash(password);

    // Normalize email (lowercase and trim)
    const normalizedEmail = emailLower;

    // Create user
    const newUserRows = await sql`
      INSERT INTO users (email, password_hash, display_name, role)
      VALUES (${normalizedEmail}, ${password_hash}, ${name || normalizedEmail}, 'user')
      RETURNING id, email, display_name, role
    `;

    const user = newUserRows[0];

    // Create session token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.AUTH_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie(SESSION_COOKIE_NAME, token, buildCookieOptions());

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
  const opts = buildCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, opts);
  res.clearCookie('__Secure-authjs.session-token', opts);
  res.json({ message: 'Signed out successfully' });
});

// Forgot Password
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists (case-insensitive email comparison)
    const emailLower = email.toLowerCase().trim();
    const userRows = await sql`
      SELECT id, email FROM users WHERE LOWER(TRIM(email)) = ${emailLower} LIMIT 1
    `;

    const userExists = userRows.length > 0;

    // Always return success to prevent email enumeration
    res.json({ message: 'If the email exists, a password reset link has been sent' });

    if (!userExists) {
      return;
    }

    const user = userRows[0];

    // Generate reset token
    const resetToken = nanoid(32);
    const tokenHash = await hash(resetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Delete any existing tokens for this user
    await sql`
      DELETE FROM password_reset_tokens WHERE user_id = ${user.id}
    `;

    // Store token in database
    await sql`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${user.id}, ${tokenHash}, ${expiresAt})
    `;

    // Send reset email
    const resetLink = `${config.FRONTEND_URL}/account/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
    try {
      await sendEmail({
        to: email,
        subject: 'Restablece tu contraseña - Spanish Blitz',
        html: resetPasswordTemplate({ resetLink })
      });
    } catch (emailError: any) {
      console.error('[auth] Failed to send password reset email:', emailError?.message);
    }
  } catch (error: any) {
    console.error('[auth] Forgot password error:', error?.message);
    // Don't change response if already sent
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Reset Password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({ error: 'Email, token, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Get user (case-insensitive email)
    const emailLower = email.toLowerCase().trim();
    const userRows = await sql`
      SELECT id FROM users WHERE LOWER(TRIM(email)) = ${emailLower} LIMIT 1
    `;

    if (userRows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const user = userRows[0];

    // Get token from database
    const tokenRows = await sql`
      SELECT id, token_hash, expires_at
      FROM password_reset_tokens
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (tokenRows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const storedToken = tokenRows[0];

    // Check if token is expired
    if (new Date(storedToken.expires_at) < new Date()) {
      await sql`DELETE FROM password_reset_tokens WHERE id = ${storedToken.id}`;
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    // Verify token
    const isValidToken = await verify(storedToken.token_hash, token);
    if (!isValidToken) {
      return res.status(400).json({ error: 'Invalid reset token' });
    }

    // Hash new password
    const passwordHash = await hash(newPassword);

    // Update password
    await sql`
      UPDATE users
      SET password_hash = ${passwordHash}, updated_at = NOW()
      WHERE id = ${user.id}
    `;

    // Delete used token
    await sql`DELETE FROM password_reset_tokens WHERE id = ${storedToken.id}`;

    console.log(`[auth] Password reset successful for: ${email}`);

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
