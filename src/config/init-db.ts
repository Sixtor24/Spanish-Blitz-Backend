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
        deck_id UUID NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        due_date TIMESTAMPTZ,
        required_repetitions INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS assignment_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL,
        score INTEGER,
        completed_at TIMESTAMPTZ,
        repetitions_completed INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(assignment_id, student_id)
      )
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

    // Create indexes for performance
    await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_classrooms_code ON classrooms(code)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memberships_classroom ON classroom_memberships(classroom_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memberships_student ON classroom_memberships(student_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_study_events_user ON study_events(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_study_events_card ON study_events(card_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_study_events_created ON study_events(created_at)`;

    initialized = true;
    console.log('✅ Database schema initialized');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}
