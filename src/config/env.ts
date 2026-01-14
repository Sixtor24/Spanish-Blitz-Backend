/**
 * Environment configuration
 */
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export const config = {
  // Server
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL || '',
  
  // Authentication
  AUTH_SECRET: process.env.AUTH_SECRET || '',
  AUTH_URL: process.env.AUTH_URL || 'http://localhost:3001',
  
  // Email
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || '',
  
  // Speech Recognition (for Brave compatibility)
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY || '',
  
  // Application
  APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:4000',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:4000',
  CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://localhost:4000',
  
  // AWS
  AWS_REGION: process.env.AWS_REGION || 'us-east-1', // us-east-1 supports Polly neural voices
} as const;

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'AUTH_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
] as const;

const missingEnvVars = requiredEnvVars.filter((key) => !config[key]);

if (missingEnvVars.length > 0 && config.NODE_ENV !== 'development') {
  console.warn(`⚠️  Missing environment variables: ${missingEnvVars.join(', ')}`);
}

export type Config = typeof config;

