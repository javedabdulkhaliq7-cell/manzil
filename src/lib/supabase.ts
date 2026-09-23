import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Profile = {
  id: string
  full_name: string
  name: string
  class_level: string
  board: string
  district: string
  plan: string
  xp: number
  streak_days: number
  last_study_date: string | null
  mcq_used_today: number
  ai_used_today: number
  mcq_reset_date: string | null
  ai_reset_date: string | null
  has_completed_first_task: boolean
  // Weekly study-day commitment (3, 5, or 7 = "every day"). Null until the
  // student answers the one-time prompt shown right after their first
  // quiz completion — see setWeeklyGoal() in lib/progress.ts.
  weekly_goal_days: number | null
  // Hearts (Quiz/Exercise attempt limiter — never Mock Tests/Notes). Lazily
  // reset: a stale hearts_reset_date means "5 hearts, not yet written" —
  // see heartsRemaining() in lib/progress.ts, same pattern as mcq_reset_date.
  hearts_current: number
  hearts_reset_date: string | null
  // Monthly free cap on Mock Tests/Past Papers — same lazy-reset pattern
  // as hearts above. See mockTestsRemainingThisMonth() in lib/progress.ts.
  mock_tests_used_this_month: number
  mock_test_reset_month: string | null
  // True once this student has ever seen the new-account welcome flow
  // (WelcomeMomentScreen). Set the moment they first see it — checked by
  // AuthCallbackScreen/SignupScreen/LoginScreen to decide Welcome Moment
  // (new) vs Welcome Back (returning), deterministically rather than via
  // account-age timestamps.
  has_seen_welcome: boolean
  created_at: string
  // Leaderboard v2 — running total of correct MCQ answers, kept in sync
  // server-side by trg_add_correct_mcqs. Not directly writable by clients.
  correct_mcqs: number
  // Index into the curated DiceBear Avataaars set in lib/constants.ts.
  avatar_id: number
  // Optional "place of learning" (school/academy), free text.
  school_name: string | null
  // Privacy toggle — school_name only ever shown to other students when true.
  show_school: boolean
}

export type Subject = {
  id: string
  name: string
  emoji: string
  color_class: string
  class_level: string
  chapter_count: number
  mcq_count: number
}

export type NotesSection =
  | { type: 'bullets'; title: string; items: string[] }
  | { type: 'table'; title: string; columns: string[]; rows: string[][] }

export type GlossaryEntry = { term: string; definition: string }
export type MnemonicEntry = { concept: string; mnemonic: string; how_to_use: string }
export type CommonMistakeEntry = { mistake: string; correct: string; why: string }
export type ImportantTopicEntry = { topic: string; weight: 'HIGH' | 'MEDIUM' | 'LOW' }
export type GrammarPointEntry = { point: string; explanation: string; examples?: string[] }

export type Chapter = {
  id: string
  subject_id: string
  number: number
  title: string
  mcq_count: number
  is_locked: boolean
  summary?: string
  detailed_notes?: NotesSection[]
  key_points?: string[]
  important_topics?: ImportantTopicEntry[]
  glossary?: GlossaryEntry[]
  mnemonics?: MnemonicEntry[]
  common_mistakes?: CommonMistakeEntry[]
  grammar_point?: GrammarPointEntry[] | null
  theme?: string | null
  breakdown?: any[] | null
  definitions?: any[] | null
}

export type MCQ = {
  id: string
  chapter_id: string
  subject_id: string
  question: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_option: string
  explanation: string
  difficulty: string
  mcq_type: string
  is_free: boolean
}

export type QuizAttempt = {
  id: string
  user_id: string
  chapter_id: string | null
  subject_id: string | null
  score: number
  total: number
  correct: number
  wrong: number
  skipped: number
  time_taken: number
  xp_earned: number
  answers: { mcq_id: string; chosen: string; correct: boolean }[]
  created_at: string
}

export type UserProgress = {
  id: string
  user_id: string
  chapter_id: string
  subject_id: string
  completion_pct: number
  notes_read: boolean
  mcqs_attempted: number
  best_score: number
}
