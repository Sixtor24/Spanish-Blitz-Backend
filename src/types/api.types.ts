/**
 * Shared TypeScript types for API routes
 */
import type { Session } from '@auth/core/types';

// ============================================================================
// Request/Response Types
// ============================================================================

export interface ApiContext {
  params: Record<string, string>;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

export interface ApiSuccess<T = unknown> {
  data: T;
  message?: string;
}

// ============================================================================
// Database Types
// ============================================================================

export interface DbUser {
  id: string;
  email: string;
  display_name?: string | null;
  role?: 'user' | 'admin' | null;
  preferred_locale?: string | null;
  is_premium?: boolean | null;
  plan?: 'free' | 'premium' | null;
  has_seen_welcome?: boolean | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface DbDeck {
  id: string;
  owner_id: string | null;
  owner_user_id: string | null;
  name: string;
  title: string | null;
  description: string | null;
  language: string;
  is_public: boolean;
  primary_color_hex: string | null;
  created_at: Date;
  updated_at: Date;
  card_count?: number;
}

export interface DbCard {
  id: string;
  deck_id: string;
  question: string; // Spanish text
  answer: string; // English text
  type: 'text' | 'audio' | 'image';
  audio_url: string | null;
  image_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DbStudyEvent {
  id: string;
  user_id: string;
  card_id: string;
  result: 'correct' | 'incorrect';
  response_time_ms: number | null;
  created_at: Date;
}

export interface DbPlaySession {
  id: string;
  host_user_id: string;
  deck_id: string;
  mode: string;
  is_teacher: boolean;
  question_count: number;
  time_limit_seconds: number | null;
  status: 'pending' | 'active' | 'finished';
  started_at: Date | null;
  ends_at: Date | null;
  created_at: Date;
  code: string | null;
}

export interface DbPlaySessionPlayer {
  id: string;
  session_id: string;
  user_id: string;
  display_name: string;
  score: number;
  joined_at: Date;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface AuthSession extends Session {
  user: {
    id?: string;
    email?: string;
    name?: string;
    image?: string;
    role?: string;
  };
}

// ============================================================================
// API Request Body Types
// ============================================================================

export interface CreateDeckBody {
  title: string;
  description?: string;
  is_public?: boolean;
  primary_color_hex?: string;
}

export interface UpdateDeckBody {
  title?: string;
  description?: string;
  is_public?: boolean;
  primary_color_hex?: string;
}

export interface CreateCardBody {
  spanish_text: string;
  english_text: string;
  audio_url?: string;
  image_url?: string;
  order_index?: number;
}

export interface BulkCreateCardsBody {
  cards: Array<{
    spanish_text: string;
    english_text: string;
    audio_url?: string;
    image_url?: string;
  }>;
}

export interface UpdateUserBody {
  display_name?: string;
  preferred_locale?: string;
}

export interface UpdateUserAdminBody {
  role?: 'user' | 'admin';
  is_premium?: boolean;
  plan?: 'free' | 'premium';
}

export interface CreatePlaySessionBody {
  deck_id: string;
}

export interface JoinPlaySessionBody {
  code: string;
  display_name: string;
}

export interface SubmitAnswerBody {
  card_id: string;
  answer: string;
  response_time_ms?: number;
}

export interface CreateStudyEventBody {
  card_id: string;
  result: 'correct' | 'incorrect';
  response_time_ms?: number;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface StatsResponse {
  cardsStudied: number;
  accuracy: number;
  streak: number;
}

export interface PlaySessionStateResponse {
  session: DbPlaySession;
  players: DbPlaySessionPlayer[];
  current_card?: DbCard;
  deck: DbDeck;
}

