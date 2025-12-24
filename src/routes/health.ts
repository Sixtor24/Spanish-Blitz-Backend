/**
 * Health check route
 */
import { Router } from 'express';
import { config } from '../config/env.js';
import { sendEmail } from '../services/email.js';

const router = Router();

router.get('/', async (req, res) => {
  const required = [
    'AUTH_SECRET',
    'DATABASE_URL',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'APP_BASE_URL',
  ];

  const missing = required.filter((key) => !config[key as keyof typeof config]);

  res.status(missing.length === 0 ? 200 : 500).json({
    status: missing.length === 0 ? 'ok' : 'missing_env',
    missing,
    node: process.version,
    environment: config.NODE_ENV,
  });
});

// Email diagnostic endpoint (admin only in production)
router.post('/email-test', async (req, res) => {
  try {
    const { to } = req.body;
    const testEmail = to || 'alucard240704@gmail.com';

    console.log('[health] 📧 Email test requested:', {
      to: testEmail,
      from: config.RESEND_FROM_EMAIL,
      hasApiKey: !!config.RESEND_API_KEY,
      hasFromEmail: !!config.RESEND_FROM_EMAIL
    });

    if (!config.RESEND_API_KEY || !config.RESEND_FROM_EMAIL) {
      return res.status(500).json({
        error: 'Email service not configured',
        missing: {
          apiKey: !config.RESEND_API_KEY,
          fromEmail: !config.RESEND_FROM_EMAIL
        }
      });
    }

    await sendEmail({
      to: testEmail,
      subject: 'Test Email - Spanish Blitz',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Test Email</h2>
          <p>This is a test email from Spanish Blitz backend.</p>
          <p>If you received this, the email service is working correctly!</p>
          <p><strong>From:</strong> ${config.RESEND_FROM_EMAIL}</p>
          <p><strong>To:</strong> ${testEmail}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        </div>
      `
    });

    res.json({
      success: true,
      message: 'Test email sent successfully',
      to: testEmail,
      from: config.RESEND_FROM_EMAIL
    });
  } catch (error: any) {
    console.error('[health] ❌ Email test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || String(error),
      details: error instanceof Error ? {
        message: error.message,
        stack: error.stack
      } : error
    });
  }
});

export default router;

