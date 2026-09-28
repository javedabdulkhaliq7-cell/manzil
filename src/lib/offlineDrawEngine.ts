// lib/offlineDrawEngine.ts
//
// Phase 4.2 — local port of drawOneSource()/drawQuestions() from
// randomDrawEngine.ts. Same algorithm (candidate pool minus used pool,
// reshuffle when exhausted), but reads candidates from a downloaded
// chapter's blob instead of Supabase, and tracks "used" in
// local_used_questions_log instead of the server's used_questions_log.
//
// Chapter-scope only for now (Quiz on a single downloaded chapter) —
// subject-wide scope (random-across-subject Quiz, Mock Test) isn't
// supported here yet, since it would need every chapter in a subject
// downloaded and merged; can be added later if needed.

import { offlineDb } from './offlineDb'
import { getDownloadedChapter } from './downloadChapter'
import type { SourceTable } from './randomDrawEngine'

export interface OfflineSourceRequest {
  table: SourceTable
  count: number
  /** Required when table === 'book_exercises' — matches the online engine. */
  sectionType?: string
  unitLabel?: string
}

export type OfflineDrawResult = Record<string, any[]>

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function resultKey(req: OfflineSourceRequest): string {
  return req.sectionType ? `${req.table}:${req.sectionType}` : req.table
}

// Matches the shape used_questions_log snapshots are grouped under in
// downloadChapter.ts — keep these two in sync if either changes.
function sourceAndSectionKey(req: OfflineSourceRequest): string {
  return `${req.table}::${req.sectionType ?? ''}`
}

function candidateRowsFor(blobContent: Record<string, any[]>, req: OfflineSourceRequest): any[] {
  let rows = blobContent[req.table] ?? []
  if (req.table === 'book_exercises' && req.sectionType) {
    rows = rows.filter((r: any) => (r.section_type ?? '').toUpperCase() === req.sectionType!.toUpperCase())
  }
  if (req.unitLabel) {
    rows = rows.filter((r: any) => r.unit_label === req.unitLabel)
  }
  return rows
}

async function usedIdsFor(
  chapterId: string,
  req: OfflineSourceRequest,
  snapshot: Record<string, string[]>
): Promise<Set<string>> {
  const key = sourceAndSectionKey(req)
  const fromSnapshot = snapshot[key] ?? []
  const fromLocalLog = await offlineDb.local_used_questions_log
    .where('chapterId').equals(chapterId)
    .and(e => e.sourceTableAndSectionKey === key)
    .toArray()
  return new Set([...fromSnapshot, ...fromLocalLog.map(e => e.questionId)])
}

async function clearLocalLog(chapterId: string, req: OfflineSourceRequest): Promise<void> {
  const key = sourceAndSectionKey(req)
  await offlineDb.local_used_questions_log
    .where('chapterId').equals(chapterId)
    .and(e => e.sourceTableAndSectionKey === key)
    .delete()
}

async function logDrawn(chapterId: string, req: OfflineSourceRequest, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const key = sourceAndSectionKey(req)
  const loggedAt = new Date().toISOString()
  await offlineDb.local_used_questions_log.bulkAdd(
    ids.map(questionId => ({ chapterId, sourceTableAndSectionKey: key, questionId, loggedAt }))
  )
}

/**
 * Draws never-repeating questions locally for one downloaded chapter.
 * Mirrors randomDrawEngine.ts's drawQuestions() exactly — candidate pool
 * minus used pool, reshuffle (clear the local log for that source) when
 * the pool can't fill the request — but reads/writes IndexedDB instead of
 * Supabase. Throws if the chapter isn't downloaded (caller should already
 * have checked this before calling).
 */
export async function drawQuestionsOffline(
  chapterId: string,
  sources: OfflineSourceRequest[]
): Promise<OfflineDrawResult> {
  const chapter = await getDownloadedChapter(chapterId)
  if (!chapter) {
    throw new Error('This chapter has not been downloaded, so it cannot be used offline.')
  }

  const result: OfflineDrawResult = {}

  for (const req of sources) {
    const candidates = candidateRowsFor(chapter.content as any, req)
    const usedIds = await usedIdsFor(chapterId, req, chapter.usedQuestionsSnapshot ?? {})
    let available = candidates.filter((r: any) => !usedIds.has(r.id))

    // Pool exhausted (or too small) — reshuffle, same as the online engine.
    if (available.length < req.count) {
      await clearLocalLog(chapterId, req)
      available = candidates
    }

    const drawn = shuffle(available).slice(0, Math.min(req.count, available.length))
    await logDrawn(chapterId, req, drawn.map((r: any) => r.id))
    result[resultKey(req)] = drawn
  }

  return result
}
