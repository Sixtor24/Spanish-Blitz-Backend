/**
 * Classroom routes
 */
import { Router } from 'express';
import { sql } from '../config/database.js';
import { requireAuth, getCurrentUser, type AuthRequest } from '../middleware/auth.js';
import { withErrorHandler, ApiError } from '../middleware/error.js';

const router = Router();

/**
 * Ensure classroom tables exist
 */
async function ensureClassroomTables() {
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

  // Create indexes if they don't exist
  await sql`CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_classrooms_code ON classrooms(code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_memberships_classroom ON classroom_memberships(classroom_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_memberships_student ON classroom_memberships(student_id)`;
}

/**
 * Generate unique 6-character classroom code
 */
async function generateClassroomCode(): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code: string;
  let exists: boolean;

  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const result = await sql`SELECT id FROM classrooms WHERE code = ${code} LIMIT 1`;
    exists = result.length > 0;
  } while (exists);

  return code;
}

/**
 * GET /api/classrooms
 * List all classrooms (teacher's own or student's joined)
 */
router.get('/', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);

  await ensureClassroomTables();

  // Get classrooms where user is teacher or student
  const classrooms = await sql`
    SELECT DISTINCT
      c.id,
      c.teacher_id,
      c.name,
      c.description,
      c.code,
      c.color,
      c.is_active,
      c.created_at,
      c.updated_at,
      COUNT(DISTINCT cm.student_id) FILTER (WHERE cm.is_active = true) as student_count,
      COUNT(DISTINCT a.id) as assignment_count
    FROM classrooms c
    LEFT JOIN classroom_memberships cm ON c.id = cm.classroom_id
    LEFT JOIN assignments a ON c.id = a.classroom_id
    WHERE c.teacher_id = ${userId} 
       OR EXISTS (
         SELECT 1 FROM classroom_memberships m 
         WHERE m.classroom_id = c.id 
           AND m.student_id = ${userId}
           AND m.is_active = true
       )
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `;

  return res.json(classrooms);
}, 'GET /api/classrooms'));

/**
 * POST /api/classrooms
 * Create a new classroom (teacher only)
 */
router.post('/', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { name, description, color } = req.body;

  // Check if user has teacher role
  if (user.role !== 'teacher' && user.role !== 'admin') {
    throw new ApiError(403, 'Only teachers can create classrooms. Please contact an administrator to upgrade your account.');
  }

  if (!name || !name.trim()) {
    throw new ApiError(400, 'Classroom name is required');
  }

  await ensureClassroomTables();

  const code = await generateClassroomCode();

  const rows = await sql`
    INSERT INTO classrooms (teacher_id, name, description, code, color)
    VALUES (${userId}, ${name.trim()}, ${description || null}, ${code}, ${color || '#8B5CF6'})
    RETURNING *
  `;

  const classroom = rows[0];
  
  return res.status(201).json({
    ...classroom,
    student_count: 0,
    assignment_count: 0
  });
}, 'POST /api/classrooms'));

/**
 * DELETE /api/classrooms/:id
 * Delete a classroom (teacher only)
 */
router.delete('/:id', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { id } = req.params;

  await ensureClassroomTables();

  // Verify user is the teacher
  const classroom = await sql`
    SELECT * FROM classrooms WHERE id = ${id} AND teacher_id = ${userId} LIMIT 1
  `;

  if (classroom.length === 0) {
    throw new ApiError(403, 'Only the classroom teacher can delete it');
  }

  // Delete classroom (CASCADE will handle related records)
  await sql`DELETE FROM classrooms WHERE id = ${id}`;

  return res.json({ success: true });
}, 'DELETE /api/classrooms/:id'));

/**
 * GET /api/classrooms/:id
 * Get a specific classroom with details
 */
router.get('/:id', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { id } = req.params;

  await ensureClassroomTables();

  const classrooms = await sql`
    SELECT 
      c.id,
      c.teacher_id,
      c.name,
      c.description,
      c.code,
      c.color,
      c.is_active,
      c.created_at,
      c.updated_at
    FROM classrooms c
    WHERE c.id = ${id}
      AND (c.teacher_id = ${userId} 
           OR EXISTS (
             SELECT 1 FROM classroom_memberships m 
             WHERE m.classroom_id = c.id 
               AND m.student_id = ${userId}
               AND m.is_active = true
           ))
    LIMIT 1
  `;

  if (classrooms.length === 0) {
    throw new ApiError(404, 'Classroom not found');
  }

  const classroom = classrooms[0];

  // Get student count and assignment count
  const stats = await sql`
    SELECT 
      COUNT(DISTINCT cm.student_id) FILTER (WHERE cm.is_active = true) as student_count,
      COUNT(DISTINCT a.id) as assignment_count
    FROM classrooms c
    LEFT JOIN classroom_memberships cm ON c.id = cm.classroom_id
    LEFT JOIN assignments a ON c.id = a.classroom_id
    WHERE c.id = ${id}
    GROUP BY c.id
  `;

  return res.json({
    ...classroom,
    student_count: stats[0]?.student_count || 0,
    assignment_count: stats[0]?.assignment_count || 0
  });
}, 'GET /api/classrooms/:id'));

/**
 * PATCH /api/classrooms/:id
 * Update a classroom (teacher only)
 */
router.patch('/:id', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { id } = req.params;
  const { name, description, is_active } = req.body;

  await ensureClassroomTables();

  // Verify teacher ownership
  const existing = await sql`
    SELECT id FROM classrooms 
    WHERE id = ${id} AND teacher_id = ${userId}
    LIMIT 1
  `;

  if (existing.length === 0) {
    throw new ApiError(403, 'Only the teacher can update this classroom');
  }

  const rows = await sql`
    UPDATE classrooms
    SET 
      name = COALESCE(${name}, name),
      description = COALESCE(${description}, description),
      is_active = COALESCE(${is_active}, is_active),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return res.json(rows[0]);
}, 'PATCH /api/classrooms/:id'));

/**
 * DELETE /api/classrooms/:id
 * Delete a classroom (teacher only)
 */
router.delete('/:id', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { id } = req.params;

  await ensureClassroomTables();

  // Verify teacher ownership
  const existing = await sql`
    SELECT id FROM classrooms 
    WHERE id = ${id} AND teacher_id = ${userId}
    LIMIT 1
  `;

  if (existing.length === 0) {
    throw new ApiError(403, 'Only the teacher can delete this classroom');
  }

  await sql`DELETE FROM classrooms WHERE id = ${id}`;

  return res.json({ success: true });
}, 'DELETE /api/classrooms/:id'));

/**
 * POST /api/classrooms/join
 * Join a classroom using a code (student)
 */
router.post('/join', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { code } = req.body;

  if (!code || !code.trim()) {
    throw new ApiError(400, 'Classroom code is required');
  }

  await ensureClassroomTables();

  const codeUpper = code.trim().toUpperCase();

  // Find classroom by code
  const classrooms = await sql`
    SELECT id, teacher_id, name, is_active 
    FROM classrooms 
    WHERE code = ${codeUpper} AND is_active = true
    LIMIT 1
  `;

  if (classrooms.length === 0) {
    throw new ApiError(404, 'Invalid classroom code');
  }

  const classroom = classrooms[0];

  // Check if user is the teacher
  if (classroom.teacher_id === userId) {
    throw new ApiError(400, 'You are the teacher of this classroom');
  }

  // Check if already a member
  const existing = await sql`
    SELECT id FROM classroom_memberships 
    WHERE classroom_id = ${classroom.id} AND student_id = ${userId}
    LIMIT 1
  `;

  if (existing.length > 0) {
    // Reactivate if inactive
    await sql`
      UPDATE classroom_memberships 
      SET is_active = true 
      WHERE classroom_id = ${classroom.id} AND student_id = ${userId}
    `;
    return res.json({ message: 'Successfully rejoined classroom', classroom });
  }

  // Add student to classroom
  await sql`
    INSERT INTO classroom_memberships (classroom_id, student_id)
    VALUES (${classroom.id}, ${userId})
  `;

  return res.json({ message: 'Successfully joined classroom', classroom });
}, 'POST /api/classrooms/join'));

/**
 * GET /api/classrooms/:id/students
 * Get students in a classroom
 */
router.get('/:id/students', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { id } = req.params;

  await ensureClassroomTables();

  // Verify access (teacher or member)
  const access = await sql`
    SELECT id FROM classrooms 
    WHERE id = ${id} 
      AND (teacher_id = ${userId} 
           OR EXISTS (
             SELECT 1 FROM classroom_memberships m 
             WHERE m.classroom_id = ${id} 
               AND m.student_id = ${userId}
               AND m.is_active = true
           ))
    LIMIT 1
  `;

  if (access.length === 0) {
    throw new ApiError(403, 'Access denied');
  }

  const students = await sql`
    SELECT 
      u.id,
      u.email,
      u.display_name,
      cm.joined_at,
      cm.is_active
    FROM classroom_memberships cm
    JOIN users u ON u.id::text = cm.student_id
    WHERE cm.classroom_id = ${id} AND cm.is_active = true
    ORDER BY cm.joined_at DESC
  `;

  return res.json(students);
}, 'GET /api/classrooms/:id/students'));

/**
 * DELETE /api/classrooms/:id/students/:studentId
 * Remove a student from classroom (teacher only)
 */
router.delete('/:id/students/:studentId', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { id, studentId } = req.params;

  await ensureClassroomTables();

  // Verify teacher ownership
  const classroom = await sql`
    SELECT id FROM classrooms 
    WHERE id = ${id} AND teacher_id = ${userId}
    LIMIT 1
  `;

  if (classroom.length === 0) {
    throw new ApiError(403, 'Only the teacher can remove students');
  }

  await sql`
    UPDATE classroom_memberships 
    SET is_active = false 
    WHERE classroom_id = ${id} AND student_id = ${studentId}
  `;

  return res.json({ success: true });
}, 'DELETE /api/classrooms/:id/students/:studentId'));

/**
 * POST /api/classrooms/:id/assignments
 * Create an assignment (teacher only)
 * Body: { deck_id, title, description?, due_date?, student_ids?: string[] }
 * If student_ids is provided, assignment is only for those students
 * If student_ids is empty/null, assignment is for all students in classroom
 */
router.post('/:id/assignments', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { id } = req.params;
  const { deck_id, title, description, due_date, student_ids, required_repetitions } = req.body;

  if (!deck_id || !title) {
    throw new ApiError(400, 'deck_id and title are required');
  }

  await ensureClassroomTables();

  // Verify teacher ownership
  const classroom = await sql`
    SELECT id FROM classrooms 
    WHERE id = ${id} AND teacher_id = ${userId}
    LIMIT 1
  `;

  if (classroom.length === 0) {
    throw new ApiError(403, 'Only the teacher can create assignments');
  }

  const rows = await sql`
    INSERT INTO assignments (classroom_id, deck_id, title, description, due_date, required_repetitions)
    VALUES (${id}, ${deck_id}, ${title}, ${description || null}, ${due_date || null}, ${required_repetitions || 1})
    RETURNING *
  `;

  const assignment = rows[0];

  // If student_ids provided, assign only to those students
  if (student_ids && Array.isArray(student_ids) && student_ids.length > 0) {
    // Insert assignment-student relationships
    for (const studentId of student_ids) {
      await sql`
        INSERT INTO assignment_students (assignment_id, student_id)
        VALUES (${assignment.id}, ${studentId})
        ON CONFLICT (assignment_id, student_id) DO NOTHING
      `;
    }
  }
  // If no student_ids, assignment is for all students (no entries in assignment_students)

  return res.status(201).json(assignment);
}, 'POST /api/classrooms/:id/assignments'));

/**
 * GET /api/classrooms/:id/assignments
 * Get assignments for a classroom
 */
router.get('/:id/assignments', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { id } = req.params;

  await ensureClassroomTables();

  // Verify access
  const access = await sql`
    SELECT id FROM classrooms 
    WHERE id = ${id} 
      AND (teacher_id = ${userId} 
           OR EXISTS (
             SELECT 1 FROM classroom_memberships m 
             WHERE m.classroom_id = ${id} 
               AND m.student_id = ${userId}
               AND m.is_active = true
           ))
    LIMIT 1
  `;

  if (access.length === 0) {
    throw new ApiError(403, 'Access denied');
  }

  // Get classroom info to check if user is teacher
  const classroomInfo = await sql`
    SELECT teacher_id FROM classrooms WHERE id = ${id} LIMIT 1
  `;
  
  const isTeacher = classroomInfo.length > 0 && classroomInfo[0].teacher_id === userId;

  let assignments;
  
  if (isTeacher) {
    // Teachers see all assignments
    assignments = await sql`
      SELECT 
        a.*,
        d.title as deck_title,
        COUNT(DISTINCT s.student_id) FILTER (WHERE s.repetitions_completed >= a.required_repetitions) as completed_count,
        COUNT(DISTINCT cm.student_id) as total_students,
        BOOL_OR(s.student_id = ${userId} AND s.repetitions_completed >= a.required_repetitions) as completed,
        MAX(CASE WHEN s.student_id = ${userId} THEN s.completed_at ELSE NULL END) as completed_at,
        COALESCE(MAX(CASE WHEN s.student_id = ${userId} THEN s.repetitions_completed ELSE 0 END), 0) as repetitions_completed
      FROM assignments a
      JOIN decks d ON d.id = a.deck_id
      LEFT JOIN assignment_submissions s ON s.assignment_id = a.id
      LEFT JOIN classroom_memberships cm ON cm.classroom_id = a.classroom_id AND cm.is_active = true
      WHERE a.classroom_id = ${id}
      GROUP BY a.id, d.title
      ORDER BY a.created_at DESC
    `;
  } else {
    // Students only see assignments assigned to them or assignments for all students
    assignments = await sql`
      SELECT DISTINCT 
        a.*,
        d.title as deck_title,
        COUNT(DISTINCT s.student_id) FILTER (WHERE s.repetitions_completed >= a.required_repetitions) as completed_count,
        COUNT(DISTINCT cm.student_id) as total_students,
        BOOL_OR(s.student_id = ${userId} AND s.repetitions_completed >= a.required_repetitions) as completed,
        MAX(CASE WHEN s.student_id = ${userId} THEN s.completed_at ELSE NULL END) as completed_at,
        COALESCE(MAX(CASE WHEN s.student_id = ${userId} THEN s.repetitions_completed ELSE 0 END), 0) as repetitions_completed
      FROM assignments a
      JOIN decks d ON d.id = a.deck_id
      LEFT JOIN assignment_submissions s ON s.assignment_id = a.id
      LEFT JOIN classroom_memberships cm ON cm.classroom_id = a.classroom_id AND cm.is_active = true
      WHERE a.classroom_id = ${id}
        AND (
          NOT EXISTS (
            SELECT 1 FROM assignment_students ast 
            WHERE ast.assignment_id = a.id
          )
          OR
          EXISTS (
            SELECT 1 FROM assignment_students ast 
            WHERE ast.assignment_id = a.id 
              AND ast.student_id = ${userId}
          )
        )
      GROUP BY a.id, d.title
      ORDER BY a.created_at DESC
    `;
  }

  return res.json(assignments);
}, 'GET /api/classrooms/:id/assignments'));

/**
 * DELETE /api/classrooms/:id/assignments/:assignmentId
 * Delete an assignment (teacher only)
 */
router.delete('/:id/assignments/:assignmentId', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { id, assignmentId } = req.params;

  await ensureClassroomTables();

  // Verify teacher ownership
  const classroom = await sql`
    SELECT id FROM classrooms 
    WHERE id = ${id} AND teacher_id = ${userId}
    LIMIT 1
  `;

  if (classroom.length === 0) {
    throw new ApiError(403, 'Only the teacher can delete assignments');
  }

  await sql`DELETE FROM assignments WHERE id = ${assignmentId} AND classroom_id = ${id}`;

  return res.json({ success: true });
}, 'DELETE /api/classrooms/:id/assignments/:assignmentId'));

/**
 * POST /api/classrooms/:id/assignments/:assignmentId/complete
 * Mark an assignment as completed (student)
 */
router.post('/:id/assignments/:assignmentId/complete', requireAuth, withErrorHandler(async (req: AuthRequest, res) => {
  const user = await getCurrentUser(req.session!);
  const userId = String(user.id);
  const { id, assignmentId } = req.params;
  const { score } = req.body;

  await ensureClassroomTables();

  // Verify student is member of classroom
  const membership = await sql`
    SELECT * FROM classroom_memberships 
    WHERE classroom_id = ${id} AND student_id = ${userId} AND is_active = true
    LIMIT 1
  `;

  if (membership.length === 0) {
    throw new ApiError(403, 'Not a member of this classroom');
  }

  // Verify assignment exists
  const assignmentCheck = await sql`
    SELECT id FROM assignments 
    WHERE id = ${assignmentId} AND classroom_id = ${id}
    LIMIT 1
  `;

  if (assignmentCheck.length === 0) {
    throw new ApiError(404, 'Assignment not found');
  }

  await sql`
    INSERT INTO assignment_submissions (assignment_id, student_id, score, completed_at, repetitions_completed)
    VALUES (${assignmentId}, ${userId}, ${score || null}, NOW(), 1)
    ON CONFLICT (assignment_id, student_id) 
    DO UPDATE SET 
      score = ${score || null},
      completed_at = NOW(),
      repetitions_completed = assignment_submissions.repetitions_completed + 1
  `;

  return res.json({ success: true });
}, 'POST /api/classrooms/:id/assignments/:assignmentId/complete'));

export default router;
