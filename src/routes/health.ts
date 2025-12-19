/**
 * Health check route
 */
import { Router } from 'express';
import { config } from '../config/env.js';

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

export default router;

