// lib/downloadChapter.ts
//
// Phase 3, sub-phases 3.2 + 3.3: the single fetch-and-store function that
// pulls one chapter's full content bundle from Supabase into IndexedDB, plus
// the Free-plan per-subject download cap.
//
// Deliberately fetches every content table now (not just what Notes needs)
// so Phase 4 (offline Quiz/Exercise/Mock Test) doesn't need a second
// download pass later — per Section 3.1 of the spec.

import { supabase } from './supabase'
import { offlineDb, type DownloadedChapter } from './offlineDb'
import { FREE_DOWNLOADS_PER_SUBJECT } from './constants'

// English-only content lives in separate tables that don't apply to other
// subjects — skip those queries entirely for non-English chapters rather
// than fetching and storing empty arrays every time.
function isEnglishSubject(subjectName?: string | null) {
  return subjectName === 'English'
}

export async function downloadChapter(chapterId: string, userId: string): Promise<void> {
  // Chapter row + subject name/class (same query ChapterDetailScreen already
  // runs) — needed both for chapterMeta and to decide which English-only
  // tables to also fetch.
  const { data: chapterRow, error: chapterErr } = await supabase
    .from('chapters')
    .select('*, subjects(name, class_level)')
    .eq('id', chapterId)
    .single()
  if (chapterErr || !chapterRow) throw chapterErr ?? new Error('Chapter not found')

  const subjectId: string = chapterRow.subject_id
  const english = isEnglishSubject((chapterRow as any).subjects?.name)

  const baseQueries = [
    supabase.from('mcqs').select('*').eq('chapter_id', chapterId),
    supabase.from('short_questions').select('*').eq('chapter_id', chapterId),
    supabase.from('long_questions').select('*').eq('chapter_id', chapterId),
    supabase.from('fill_in_blanks').select('*').eq('chapter_id', chapterId),
    supabase.from('numericals').select('*').eq('chapter_id', chapterId),
    supabase.from('book_exercises').select('*').eq('chapter_id', chapterId),
  ] as const

  const englishQueries = english
    ? [
        supabase.from('true_false').select('*').eq('chapter_id', chapterId),
        supabase.from('word_meanings').select('*').eq('chapter_id', chapterId),
        supabase.from('translations').select('*').eq('chapter_id', chapterId),
        supabase.from('sentence_gloss').select('*').eq('chapter_id', chapterId).order('sequence_order'),
        supabase.from('stanza_questions').select('*').eq('chapter_id', chapterId),
      ]
    : []

  const [mcqsRes, shortRes, longRes, fibRes, numRes, bookExRes, ...englishRes] =
    await Promise.all([...baseQueries, ...englishQueries])

  for (const res of [mcqsRes, shortRes, longRes, fibRes, numRes, bookExRes, ...englishRes]) {
    if (res.error) throw res.error
  }

  const [trueFalseRes, wordMeaningsRes, translationsRes, sentenceGlossRes, stanzaRes] = english
    ? englishRes
    : [null, null, null, null, null]

  const bookExercises = bookExRes.data ?? []

  // learn_content is keyed by book_exercise_id — fetch it in a second step
  // once we know which book_exercise rows this chapter actually has, rather
  // than pulling the whole table.
  let learnContent: any[] = []
  const bookExerciseIds = bookExercises.map((b: any) => b.id).filter(Boolean)
  if (bookExerciseIds.length > 0) {
    const { data: lc, error: lcErr } = await supabase
      .from('learn_content')
      .select('*')
      .in('book_exercise_id', bookExerciseIds)
    if (lcErr) throw lcErr
    learnContent = lc ?? []
  }

  // Phase 4.1 — snapshot what this student has already been shown online
  // for this chapter, so a freshly-downloaded chapter doesn't immediately
  // repeat something they just saw. Grouped by "table::sectionType" to
  // match offlineDrawEngine.ts's key shape exactly.
  const { data: usedRows, error: usedErr } = await supabase
    .from('used_questions_log')
    .select('source_table, section_type, question_id')
    .eq('user_id', userId)
    .eq('scope', 'chapter')
    .eq('scope_id', chapterId)
  if (usedErr) throw usedErr

  const usedQuestionsSnapshot: Record<string, string[]> = {}
  for (const row of usedRows ?? []) {
    const key = `${row.source_table}::${row.section_type ?? ''}`
    ;(usedQuestionsSnapshot[key] ??= []).push(row.question_id)
  }

  const blob: DownloadedChapter = {
    chapterId,
    subjectId,
    downloadedAt: new Date().toISOString(),
    chapterMeta: chapterRow,
    content: {
      mcqs: mcqsRes.data ?? [],
      short_questions: shortRes.data ?? [],
      long_questions: longRes.data ?? [],
      fill_in_blanks: fibRes.data ?? [],
      numericals: numRes.data ?? [],
      book_exercises: bookExercises,
      true_false: trueFalseRes?.data ?? [],
      word_meanings: wordMeaningsRes?.data ?? [],
      translations: translationsRes?.data ?? [],
      sentence_gloss: sentenceGlossRes?.data ?? [],
      stanza_questions: stanzaRes?.data ?? [],
      learn_content: learnContent,
    },
    usedQuestionsSnapshot,
  }

  await offlineDb.downloaded_chapters.put(blob)
}

export async function removeDownloadedChapter(chapterId: string): Promise<void> {
  await offlineDb.downloaded_chapters.delete(chapterId)
  // Clear any local draw-history for this chapter too — no point keeping
  // it around once the chapter itself is gone.
  await offlineDb.local_used_questions_log.where('chapterId').equals(chapterId).delete()
}

export async function isChapterDownloaded(chapterId: string): Promise<boolean> {
  const row = await offlineDb.downloaded_chapters.get(chapterId)
  return !!row
}

export async function getDownloadedChapter(chapterId: string) {
  return offlineDb.downloaded_chapters.get(chapterId)
}

// Free-plan cap: at most FREE_DOWNLOADS_PER_SUBJECT chapters downloaded per
// subject at a time (Premium has no cap — see callers).
export async function downloadedCountForSubject(subjectId: string): Promise<number> {
  return offlineDb.downloaded_chapters.where('subjectId').equals(subjectId).count()
}

// Step 2 (offline navigation) — which chapters in this subject are
// actually downloaded, so ChaptersScreen can lock/grey out the ones that
// aren't while offline (their content genuinely isn't available).
export async function getDownloadedChapterIdsForSubject(subjectId: string): Promise<Set<string>> {
  const ids = await offlineDb.downloaded_chapters.where('subjectId').equals(subjectId).primaryKeys()
  return new Set(ids)
}

export async function canDownloadMore(subjectId: string, isPremium: boolean): Promise<boolean> {
  if (isPremium) return true
  const count = await downloadedCountForSubject(subjectId)
  return count < FREE_DOWNLOADS_PER_SUBJECT
}
