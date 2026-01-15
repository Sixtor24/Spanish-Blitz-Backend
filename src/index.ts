/**
 * Main entry point for The Spanish Blitz Backend API
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { config } from './config/env.js';
import { errorHandler } from './middleware/error.js';
import { setupWebSocket } from './services/ws-hub.js';
import { initializeDatabase } from './config/init-db.js';

// Route imports
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import decksRouter from './routes/decks.js';
import cardsRouter from './routes/cards.js';
import playSessionsRouter from './routes/play-sessions.js';
import statsRouter from './routes/stats.js';
import studyEventsRouter from './routes/study-events.js';
import adminRouter from './routes/admin.js';
import ttsRouter from './routes/tts.js';
import classroomsRouter from './routes/classrooms.js';
import speechRouter from './routes/speech.js';

const app = express();
const httpServer = createServer(app);

// Security middleware
app.use(helmet());

// CORS configuration - allow multiple frontend URLs
const corsOrigins = config.CORS_ORIGINS.split(',').map(origin => origin.trim());
const allowedOrigins = [
  ...corsOrigins,
  'http://localhost:4000',
  'http://localhost:4001',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Setup WebSocket for real-time features
setupWebSocket(httpServer);

// API Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/decks', decksRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/play-sessions', playSessionsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/study-events', studyEventsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/tts', ttsRouter);
app.use('/api/classrooms', classroomsRouter);
app.use('/api/speech', speechRouter);

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize database schema and start server
const PORT = config.PORT;

async function startServer() {
  try {
    // Initialize database schema once at startup
    await initializeDatabase();
    
    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log('\n==============================================');
      console.log(`🚀 Spanish Blitz API Server running on port ${PORT}`);
      console.log(`📍 Environment: ${config.NODE_ENV}`);
      console.log(`🌐 CORS enabled for: ${config.FRONTEND_URL}`);
      console.log(`🔐 Auth URL: ${config.AUTH_URL}`);
      console.log(`📊 Database: ${config.DATABASE_URL ? 'Connected' : 'Not configured'}`);
      console.log(`🔌 WebSocket: Enabled (Speech Streaming)`);
      console.log(`🎤 Deepgram: ${process.env.DEEPGRAM_API_KEY ? 'Configured' : 'Not configured'}`);
      console.log('==============================================\n');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export { app, httpServer };

