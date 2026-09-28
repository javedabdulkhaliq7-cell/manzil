// lib/offlineDb.ts
//
// IndexedDB (via Dexie) — the four local tables from the offline-mode spec,
// Section 3. This file only DEFINES the schema; the actual download/read/
// sync logic lives in downloadChapter.ts (Phase 3) and later files (Phase 4+).

import Dexie, { type Table } from 'dexie'
import type { Profile, Subject, Chapter } from './supabase'

// One row per downloaded chapter — a single JSON blob per chapter rather
// than one row per question, so a download is one atomic write and a read
// is one lookup.
export type DownloadedChapter = {
  chapterId: string
  subjectId: string
  downloadedAt: string // ISO
  chapterMeta: any // the raw `chapters` row (number, title, summary, detailed_notes,
                    // glossary, mnemonics, common_mistakes, important_topics,
                    // theme, breakdown, definitions, grammar_point, etc.)
  content: {
    mcqs: any[]
    short_questions: any[]
    long_questions: any[]
    fill_in_blanks: any[]
    numericals: any[]
    book_exercises: any[]
    true_false: any[]
    word_meanings: any[]
    translations: any[]
    sentence_gloss: any[]
    stanza_questions: any[]
    learn_content: any[]
  }
  // Populated in Phase 4 (offline draw engine) — left empty here in Phase 3,
  // since Notes-only offline viewing doesn't need never-repeat tracking yet.
  usedQuestionsSnapshot: Record<string, string[]>
}

// Grows locally as the student takes tests offline (Phase 4+). Defined now
// per the spec's schema, not yet written to until Phase 4.
export type LocalUsedQuestionsLogEntry = {
  id?: number // Dexie auto-increment
  chapterId: string
  sourceTableAndSectionKey: string
  questionId: string
  loggedAt: string // ISO
}

// One row per completed quiz/test attempt taken offline (Phase 5). Written
// by QuizScreen.tsx's offline submit path; consumed and cleared by
// lib/syncEngine.ts.
export type PendingSyncEntry = {
  localId: string // uuid, client-generated
  type: 'quiz' | 'exercise_test' | 'mock_test' | 'chapter_mock_test'
  userId: string
  chapterId: string | null
  subjectId: string | null
  completedAt: string // ISO, real device timestamp
  quizAttemptPayload: any
  newlyUsedQuestionIds: Record<string, string[]>
  heartsLostDuringAttempt: number
  syncStatus: 'pending' | 'syncing' | 'failed'
  syncAttempts: number
  // Which server-side steps of the sync already finished for this row, so
  // a retry after a mid-way failure skips them instead of repeating them
  // (which would double-count the attempt, XP, or hearts). Not indexed.
  doneSteps?: string[]
}

// Single cached row of the student's own full profile — kept fresh on
// every successful Supabase read. Two uses: (1) Phase 6's hearts/plan
// gating reads specific fields off it while offline; (2) AuthContext
// falls back to this WHOLE object as `profile` when a cold app launch
// has no connection at all — without this, every profile-gated screen
// (Home included) would render nothing rather than the student's real,
// last-known stats.
export type LocalProfileCache = {
  id: 'current' // fixed key — always exactly one row
  profile: Profile
  cachedAt: string // ISO
}

// Step 2 (offline navigation) — lightweight cache of the Subjects and
// Chapters LISTS themselves, separate from downloaded_chapters' full
// content blobs. Populated automatically every time the student browses
// these screens online; read from when offline so navigation itself
// works with zero connection — not just a downloaded chapter's content.
// A chapter appearing here does NOT mean it's usable offline; only
// downloaded_chapters (downloadChapter.ts) determines that.
export type CachedSubject = Subject & { cachedAt: string }
export type CachedChapter = Chapter & { cachedAt: string }

class IqraOfflineDb extends Dexie {
  downloaded_chapters!: Table<DownloadedChapter, string>
  local_used_questions_log!: Table<LocalUsedQuestionsLogEntry, number>
  pending_sync!: Table<PendingSyncEntry, string>
  local_profile_cache!: Table<LocalProfileCache, string>
  cached_subjects!: Table<CachedSubject, string>
  cached_chapters!: Table<CachedChapter, string>

  constructor() {
    super('iqra_offline')
    this.version(1).stores({
      // chapterId is the primary key — one row per chapter, upsert on re-download.
      downloaded_chapters: 'chapterId, subjectId',
      // auto-increment id; indexed by chapterId so a chapter's log entries
      // can be queried/cleared together (needed for the reshuffle case).
      local_used_questions_log: '++id, chapterId, sourceTableAndSectionKey',
      // localId is the primary key; indexed by syncStatus so the sync
      // process can efficiently pull just the pending/failed rows.
      pending_sync: 'localId, syncStatus',
      local_profile_cache: 'id',
    })
    // Dexie only needs the DELTA per version — v1's four tables above
    // carry forward unchanged; this just adds the two new ones.
    this.version(2).stores({
      cached_subjects: 'id, class_level',
      cached_chapters: 'id, subject_id',
    })
  }
}

export const offlineDb = new IqraOfflineDb()
