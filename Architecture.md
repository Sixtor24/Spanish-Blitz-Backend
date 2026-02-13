# Spanish Blitz Backend — Architecture

## Overview

The Spanish Blitz Backend is a **Node.js / Express** REST API that powers the Spanish Blitz language-learning platform. It provides authentication, deck/card management, real-time multiplayer challenges, classroom management, XP gamification, text-to-speech, and speech recognition.

**Tech Stack:** TypeScript, Express 4, PostgreSQL (Railway), JWT auth, WebSockets, Google Cloud TTS, Deepgram STT, Resend (email).

---

## Directory Structure

```
src/
├── index.ts                 # Application entry point & server bootstrap
├── config/                  # Configuration layer
│   ├── env.ts               # Environment variables (single source of truth)
│   ├── database.ts          # PostgreSQL connection pool & SQL wrapper
│   ├── auth.ts              # Auth.js adapter (credentials-based auth)
│   └── init-db.ts           # Database schema initialization (runs at startup)
├── middleware/               # Express middleware
│   ├── auth.ts              # Authentication & authorization middleware
│   └── error.ts             # Error handling (ApiError class, asyncHandler)
├── routes/                   # API route handlers (controllers)
│   ├── auth.ts              # POST /signin, /signup, /signout, /forgot-password, /reset-password
│   ├── users.ts             # GET/PATCH /users/current, /mark-welcome-seen
│   ├── decks.ts             # CRUD /decks, /decks/:id/cards, /cards/bulk
│   ├── cards.ts             # GET/PATCH/DELETE /cards/:id
│   ├── play-sessions.ts     # Blitz Challenge multiplayer sessions
│   ├── classrooms.ts        # Classroom CRUD, join, students, assignments
│   ├── xp.ts                # XP awards for solo blitz, blitz challenge, assignments
│   ├── stats.ts             # User study statistics
│   ├── study-events.ts      # Study event recording
│   ├── admin.ts             # Admin user management
│   ├── tts.ts               # Google Cloud Text-to-Speech synthesis
│   ├── speech.ts            # Speech evaluation
│   └── health.ts            # Health check & email diagnostics
├── services/                 # Business logic & external integrations
│   ├── email.ts             # Resend email service
│   ├── google-cloud-tts.ts  # Google Cloud TTS integration
│   ├── speech-stream.ts     # Deepgram real-time speech streaming
│   ├── speechUtils.ts       # Speech answer evaluation logic
│   ├── upload.ts            # File upload utilities
│   └── ws-hub.ts            # WebSocket server (play sessions + speech streaming)
└── types/
    └── api.types.ts          # Shared TypeScript interfaces
```

---

## Architecture Layers

### 1. Configuration (`config/`)

| File | Responsibility |
|------|---------------|
| `env.ts` | Centralised environment variable access with validation. Single source of truth for all config values. |
| `database.ts` | Exports a shared `pg.Pool` and a `sql` tagged-template wrapper that supports both template literal and parameterised query styles. |
| `auth.ts` | Auth.js adapter using the shared database pool. Implements credentials-based authentication (sign-in and sign-up flows). |
| `init-db.ts` | Idempotent schema migration that runs once at startup. Uses `IF NOT EXISTS` and `DO $$ ... END$$` blocks to safely add tables, columns, and indexes. |

### 2. Middleware (`middleware/`)

| Middleware | Purpose |
|-----------|---------|
| `requireAuth` | Extracts JWT from cookies, verifies it, attaches `req.session` with user info. |
| `requireAdmin` | Extends `requireAuth` with an admin role check. |
| `errorHandler` | Global Express error handler. Distinguishes `ApiError` (operational) from unexpected errors. |
| `asyncHandler` | Promise wrapper that forwards async errors to Express `next()`. |
| `withErrorHandler` | Combines `asyncHandler` with contextual error logging. |

**Auth Flow:**
```
Cookie (authjs.session-token) → JWT verify → DB user lookup → req.session
```

### 3. Routes (`routes/`)

Each route file is a self-contained Express Router mounted at `/api/<domain>`.

| Domain | Key Endpoints | Auth |
|--------|--------------|------|
| **Auth** | signin, signup, signout, forgot-password, reset-password | Public |
| **Users** | GET/PATCH current user, mark-welcome-seen | `requireAuth` |
| **Decks** | CRUD decks, list/create/bulk-create cards | `requireAuth` (writes) |
| **Cards** | GET/PATCH/DELETE individual cards | `requireAuth` (writes) |
| **Play Sessions** | Create, join, start, answer, kick player | JWT via `getCurrentUserOr401` |
| **Classrooms** | CRUD classrooms, join, students, assignments | `requireAuth` |
| **XP** | Solo blitz complete, blitz challenge finalize, leaderboard, history | `requireAuth` (writes) |
| **Stats** | Aggregated study statistics | `requireAuth` |
| **Study Events** | Record study events | `requireAuth` |
| **Admin** | User CRUD (role/plan management) | `requireAdmin` |
| **TTS** | Synthesize speech, list voices, config check | `requireAuth` (synthesize) |
| **Speech** | Evaluate speech transcript | Public |
| **Health** | Health check, email test | Public / `requireAdmin` |

### 4. Services (`services/`)

| Service | Responsibility |
|---------|---------------|
| `email.ts` | Sends transactional emails via Resend API (password reset, premium activation). |
| `google-cloud-tts.ts` | Google Cloud TTS integration with voice selection and locale mapping. |
| `speech-stream.ts` | Manages Deepgram WebSocket sessions for real-time speech-to-text. |
| `speechUtils.ts` | Evaluates speech transcripts against target answers with lenient matching. |
| `ws-hub.ts` | WebSocket server for play session subscriptions and speech streaming. |

---

## Database

**Engine:** PostgreSQL on Railway (SSL required).

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (email, password_hash, role, plan, xp_total, preferences) |
| `decks` | Card sets (title, description, owner, color, visibility) |
| `cards` | Flashcards (question/answer pairs with optional notes) |
| `study_events` | Individual study interactions (card, result, mode) |
| `play_sessions` | Multiplayer Blitz Challenge sessions |
| `play_session_players` | Players in a session (score, state) |
| `play_session_questions` | Questions selected for a session |
| `play_session_answers` | Player answers to questions |
| `classrooms` | Teacher classrooms with invite codes |
| `classroom_memberships` | Student-classroom relationships |
| `assignments` | Teacher-created assignments (deck-based or XP-goal-based) |
| `assignment_submissions` | Student progress on assignments |
| `assignment_students` | Targeted assignment-student relationships |
| `xp_events` | XP award log (solo_blitz, blitz_challenge, assignment) |
| `password_reset_tokens` | Time-limited password reset tokens |

### Connection Management

- **Pool size:** 10 connections max
- **Idle timeout:** 30s
- **Connection timeout:** 15s
- **Keep-alive:** Enabled (10s initial delay)
- **SSL:** Required (`rejectUnauthorized: false` for Railway proxy)

---

## Authentication & Security

- **Strategy:** JWT stored in HTTP-only cookies
- **Hashing:** Argon2 for passwords and reset tokens
- **Cookie config:** `httpOnly`, `secure`, `sameSite: none` (production), `partitioned` (CHIPS for Chrome incognito)
- **Token lifetime:** 7 days
- **CORS:** Whitelist-based with credentials support
- **Security headers:** Helmet.js
- **Body limits:** 10MB max
- **Authorization:** Role-based (user, teacher, admin) with ownership checks on resources

---

## Real-Time Features

### WebSocket Hub (`ws-hub.ts`)

Two distinct message protocols share a single WebSocket server:

1. **Play Session Subscriptions** — Clients subscribe to a session ID and receive `session:refresh` broadcasts when state changes.
2. **Speech Streaming** — Clients open a Deepgram session, stream audio chunks, and receive real-time transcription results.

---

## Deployment

- **Platform:** Railway
- **Build:** `tsc --project tsconfig.build.json` → `dist/`
- **Start:** `node dist/index.js`
- **Dev:** `tsx watch src/index.ts`
- **Node:** >= 20.0.0
