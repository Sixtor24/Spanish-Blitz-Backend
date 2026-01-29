/**
 * Database initialization - runs once at startup
 * Ensures all tables, columns, and indexes exist
 */
import { sql } from './database.js';

let initialized = false;

export async function initializeDatabase() {
  if (initialized) return;

  console.log('🔧 Initializing database schema...');

  try {
    // Ensure user columns exist
    await sql`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_locale text;
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
          ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_welcome boolean DEFAULT false;
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
          ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_voice_gender text DEFAULT 'female';
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
          ALTER TABLE users ADD COLUMN IF NOT EXISTS xp_total INTEGER NOT NULL DEFAULT 0;
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
          ALTER TABLE users ADD COLUMN IF NOT EXISTS tts_voice_id text;
        EXCEPTION WHEN others THEN NULL; END;
      END$$;
    `;

    // Ensure cards table has notes column
    await sql`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE cards ADD COLUMN IF NOT EXISTS notes text;
        EXCEPTION WHEN others THEN NULL; END;
      END$$;
    `;

    // Create classroom tables
    await sql`
      CREATE TABLE IF NOT EXISTS classrooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        teacher_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        code VARCHAR(6) UNIQUE NOT NULL,
        color VARCHAR(7) DEFAULT '#8B5CF6',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS classroom_memberships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true,
        UNIQUE(classroom_id, student_id)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
        deck_id UUID,
        title TEXT NOT NULL,
        description TEXT,
        due_date TIMESTAMPTZ,
        required_repetitions INTEGER DEFAULT 1,
        xp_goal INTEGER,
        xp_reward INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Add xp_goal and xp_reward columns if they don't exist
    await sql`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE assignments ADD COLUMN IF NOT EXISTS xp_goal INTEGER;
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
          ALTER TABLE assignments ADD COLUMN IF NOT EXISTS xp_reward INTEGER;
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
          ALTER TABLE assignments ALTER COLUMN deck_id DROP NOT NULL;
        EXCEPTION WHEN others THEN NULL; END;
      END$$;
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS assignment_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL,
        score INTEGER,
        completed_at TIMESTAMPTZ,
        repetitions_completed INTEGER DEFAULT 0,
        xp_earned_since_assignment INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(assignment_id, student_id)
      )
    `;

    // Add xp_earned_since_assignment column if it doesn't exist
    await sql`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS xp_earned_since_assignment INTEGER DEFAULT 0;
        EXCEPTION WHEN others THEN NULL; END;
      END$$;
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS assignment_students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(assignment_id, student_id)
      )
    `;

    // XP Events table
    await sql`
      CREATE TABLE IF NOT EXISTS xp_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('study', 'solo_blitz', 'blitz_challenge', 'assignment')),
        xp_earned INTEGER NOT NULL CHECK (xp_earned >= 0),
        set_id UUID NULL,
        challenge_id UUID NULL,
        session_id TEXT NULL,
        assignment_id UUID NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Add unique constraint for blitz_challenge to prevent duplicate XP awards
    await sql`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE xp_events ADD CONSTRAINT xp_events_blitz_challenge_unique 
          UNIQUE (user_id, mode, challenge_id);
        EXCEPTION 
          WHEN duplicate_table THEN NULL;
          WHEN duplicate_object THEN NULL;
        END;
      END$$;
    `;

    // Add is_finalized column to play_sessions to prevent duplicate XP awards
    await sql`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE play_sessions ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN DEFAULT false;
        EXCEPTION WHEN others THEN NULL; END;
      END$$;
    `;

    // Add xp_reward column to assignments
    await sql`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE assignments ADD COLUMN IF NOT EXISTS xp_reward INTEGER NULL;
        EXCEPTION WHEN others THEN NULL; END;
      END$$;
    `;

    // Create indexes for performance
    await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_classrooms_code ON classrooms(code)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memberships_classroom ON classroom_memberships(classroom_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memberships_student ON classroom_memberships(student_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_study_events_user ON study_events(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_study_events_card ON study_events(card_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_study_events_created ON study_events(created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_xp_events_user ON xp_events(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_xp_events_created ON xp_events(created_at)`;

    initialized = true;
    console.log('✅ Database schema initialized');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}
