# Spanish Blitz Backend API

Backend API server for The Spanish Blitz application - a Spanish learning platform with flashcards, audio, and voice recognition.

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Database**: PostgreSQL (Neon)
- **Authentication**: Auth.js
- **Language**: TypeScript

## Getting Started

### Prerequisites

- Node.js 20 or higher
- PostgreSQL database (Neon recommended)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and configure your environment variables:
```bash
cp .env.example .env
```

3. Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:3001`

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run typecheck` - Run TypeScript type checking

## API Routes

### Health
- `GET /api/health` - Health check endpoint

### Authentication
- `POST /api/auth/*` - Auth.js routes (signin, signup, session)
- `GET /api/auth/token` - Get JWT token
- `POST /api/auth/forgot-password` - Password reset

### Users
- `GET /api/users/current` - Get current user
- `PATCH /api/users/current` - Update current user
- `POST /api/users/mark-welcome-seen` - Mark welcome modal as seen
- `GET /api/admin/users` - List all users (admin only)
- `GET /api/admin/users/:id` - Get user by ID (admin only)
- `PUT /api/admin/users/:id` - Update user (admin only)
- `DELETE /api/admin/users/:id` - Delete user (admin only)

### Decks
- `GET /api/decks` - List decks
- `POST /api/decks` - Create deck
- `GET /api/decks/:id` - Get deck by ID
- `PUT /api/decks/:id` - Update deck
- `DELETE /api/decks/:id` - Delete deck

### Cards
- `GET /api/decks/:id/cards` - List cards in deck
- `POST /api/decks/:id/cards` - Create card
- `POST /api/decks/:id/cards/bulk` - Bulk create cards
- `GET /api/cards/:id` - Get card by ID
- `PUT /api/cards/:id` - Update card
- `DELETE /api/cards/:id` - Delete card

### Play Sessions (Blitz Challenges)
- `POST /api/play-sessions` - Create play session
- `POST /api/play-sessions/join` - Join play session
- `POST /api/play-sessions/:id/start` - Start play session
- `GET /api/play-sessions/:id/state` - Get session state
- `POST /api/play-sessions/:id/answer` - Submit answer

### Stats & Study
- `GET /api/stats` - Get user statistics
- `POST /api/study-events` - Record study event

## Environment Variables

See `.env.example` for all required environment variables.

## Architecture

```
src/
├── index.ts              # Application entry point
├── config/              # Configuration files
│   ├── auth.ts         # Auth.js configuration
│   └── database.ts     # Database connection
├── middleware/          # Express middleware
│   ├── auth.ts         # Authentication middleware
│   ├── error.ts        # Error handling
│   └── validation.ts   # Request validation
├── routes/             # API routes
│   ├── auth.ts
│   ├── users.ts
│   ├── decks.ts
│   ├── cards.ts
│   ├── play-sessions.ts
│   ├── stats.ts
│   └── admin.ts
├── services/           # Business logic
│   ├── email.ts
│   └── upload.ts
├── types/             # TypeScript types
│   └── api.types.ts
└── utils/            # Utility functions
    ├── error-handler.ts
    └── ws-hub.ts
```

## License

Private - All rights reserved

