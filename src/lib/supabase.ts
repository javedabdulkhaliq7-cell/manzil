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
  created_at: string
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