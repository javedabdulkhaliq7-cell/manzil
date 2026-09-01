// randomDrawEngine.ts
//
// Phase 1 foundation piece (see IQRA_NEW_FEATURES_AND_PHASES.md).
// One function, parameterized by scope, that:
//   (a) excludes questions already logged as "used" for that student+scope
//   (b) draws N questions per requested section/source
//   (c) once a pool is exhausted, clears the log for that source and
//       starts over ("reshuffle the deck")
//
// Deliberately has NO UI dependency — this is pure data-layer logic,
// callable from a scratch script or any screen. Nothing here assumes
// which screen is calling it.
//
// Source tables have separate ID spaces, so every logged/drawn question
// is tracked as (source_table, question_id) together — see the
// used_questions_log migration.

import { supabase } from './supabase'

export type SourceTable = 'mcqs' | 'short_questions' | 'long_questions' | 'numericals' | 'book_exercises' | 'fill_in_blanks' | 'true_false' | 'translations'

export type DrawScope = 'chapter' | 'subject'

export interface SourceRequest {
  /** Which table to draw from. */
  table: SourceTable
  /** How many questions to draw from this source. */
  count: number
  /**
   * Only for `book_exercises`, which holds multiple question types in one
   * table (MCQ / Short / Extended / Numerical / Fill-in-Blank / True-False)
   * distinguished by this column. Required when table === 'book_exercises'.
   */
  sectionType?: string
  /**
   * Optional sub-unit scope, e.g. "1.1" / "1.2" / "REVIEW" for Math.
   * When present, the candidate pool is additionally filtered to rows
   * whose `unit_label` matches exactly. Omit (or leave undefined) for
   * every existing caller (Bio/Chem/Physics, and any Math draw that
   * intentionally wants the whole chapter) — this is purely additive,
   * data-driven by whichever rows actually carry a unit_label, and does
   * not change behavior for anything that doesn't pass it.
   */
  unitLabel?: string
}

export interface DrawParams {
  userId: string
  scope: DrawScope
  /** chapter_id when scope === 'chapter', subject_id when scope === 'subject' */
  scopeId: string
  sources: SourceRequest[]
}

/** Result keyed by table name (and sectionType, if given, joined with a colon)
 *  so callers can request the same table twice with different sectionTypes
 *  (e.g. book_exercises MCQ + book_exercises Short) without collisions. */
export type DrawResult = Record<string, any[]>

function resultKey(req: SourceRequest): string {
  return req.sectionType ? `${req.table}:${req.sectionType}` : req.table
}

/** Resolves the chapter_id filter(s) to query against, given the scope. */
async function resolveChapterIds(scope: DrawScope, scopeId: string): Promise<string[]> {
  if (scope === 'chapter') return [scopeId]
  const { data, error } = await supabase.from('chapters').select('id').eq('subject_id', scopeId)
  if (error) throw error
  return (data ?? []).map(r => r.id as string)
}

/** Fetches the full candidate ID pool for one source request. */
async function fetchCandidateIds(chapterIds: string[], req: SourceRequest): Promise<string[]> {
  let query = supabase.from(req.table).select('id').in('chapter_id', chapterIds)
  if (req.table === 'book_exercises') {
    if (!req.sectionType) {
      throw new Error(`sectionType is required when drawing from book_exercises (requested table=${req.table})`)
    }
    query = query.ilike('section_type', req.sectionType)
  }
  if (req.unitLabel) {
    query = query.eq('unit_label', req.unitLabel)
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(r => r.id as string)
}

/**
 * used_questions_log.section_type disambiguates source tables that hold
 * more than one logical question type under one source_table value —
 * currently only `book_exercises` (MCQ/Short/Extended/Numerical all live
 * there, distinguished by SourceRequest.sectionType). Every request that
 * sets `sectionType` gets its own independent exhaustion/reshuffle
 * tracking; requests without one (every other table) share the ''
 * bucket, unaffected. Without this, reshuffling one section type's
 * exhausted pool would wipe the used-log for every other section type
 * sharing the same source_table, causing premature repeats. See the
 * used_questions_log migration (adds this column + widens the unique
 * constraint) for the schema side of this fix.
 */
function sectionKey(req: SourceRequest): string {
  return req.sectionType ?? ''
}

/** Fetches this user's already-used IDs for one source, within this scope. */
async function fetchUsedIds(userId: string, scope: DrawScope, scopeId: string, req: SourceRequest): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('used_questions_log')
    .select('question_id')
    .eq('user_id', userId)
    .eq('scope', scope)
    .eq('scope_id', scopeId)
    .eq('source_table', req.table)
    .eq('section_type', sectionKey(req))
  if (error) throw error
  return new Set((data ?? []).map(r => r.question_id as string))
}

/** Clears the used-log for one source within this scope — the "reshuffle". */
async function clearUsedLog(userId: string, scope: DrawScope, scopeId: string, req: SourceRequest): Promise<void> {
  const { error } = await supabase
    .from('used_questions_log')
    .delete()
    .eq('user_id', userId)
    .eq('scope', scope)
    .eq('scope_id', scopeId)
    .eq('source_table', req.table)
    .eq('section_type', sectionKey(req))
  if (error) throw error
}

/** Logs a batch of drawn IDs as "used". Upsert-safe (ignores duplicates). */
async function logUsedIds(userId: string, scope: DrawScope, scopeId: string, req: SourceRequest, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const rows = ids.map(question_id => ({
    user_id: userId,
    scope,
    scope_id: scopeId,
    source_table: req.table,
    section_type: sectionKey(req),
    question_id,
  }))
  const { error } = await supabase.from('used_questions_log').upsert(rows, {
    onConflict: 'user_id,scope,scope_id,source_table,section_type,question_id',
    ignoreDuplicates: true,
  })
  if (error) throw error
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * Draws `req.count` never-repeating questions (per user+scope) from one
 * source. Reshuffles (clears the log) automatically if the remaining
 * unused pool can't satisfy the requested count.
 */
async function drawOneSource(userId: string, scope: DrawScope, scopeId: string, req: SourceRequest): Promise<string[]> {
  const chapterIds = await resolveChapterIds(scope, scopeId)
  const candidateIds = await fetchCandidateIds(chapterIds, req)
  let usedIds = await fetchUsedIds(userId, scope, scopeId, req)
  let available = candidateIds.filter(id => !usedIds.has(id))

  // Pool exhausted (or too small to fulfill this draw) — reshuffle.
  if (available.length < req.count) {
    await clearUsedLog(userId, scope, scopeId, req)
    available = candidateIds
  }

  const drawn = shuffle(available).slice(0, Math.min(req.count, available.length))
  await logUsedIds(userId, scope, scopeId, req, drawn)
  return drawn
}

/** Fetches full rows for a set of drawn IDs from one table. */
async function fetchRowsByIds(table: SourceTable, ids: string[]): Promise<any[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from(table).select('*').in('id', ids)
  if (error) throw error
  return data ?? []
}

/**
 * Main entry point. Draws questions across one or more sources for a
 * given user+scope, never repeating a question until its source's pool
 * is exhausted (per user, per scope), at which point that source alone
 * reshuffles.
 *
 * Each source is drawn and logged independently, so a Mock Test that
 * merges mcqs + short_questions + ... reshuffles each source on its own
 * schedule, not all-or-nothing.
 */
export async function drawQuestions(params: DrawParams): Promise<DrawResult> {
  const { userId, scope, scopeId, sources } = params
  const result: DrawResult = {}

  for (const req of sources) {
    const drawnIds = await drawOneSource(userId, scope, scopeId, req)
    const rows = await fetchRowsByIds(req.table, drawnIds)
    result[resultKey(req)] = rows
  }

  return result
}

// ============================================================
// Merged-pool draws.
//
// Mock Test's spec (see IQRA_NEW_FEATURES_AND_PHASES.md, Phase 2) needs a
// genuinely combined random pool per section — e.g. Section A draws from
// `mcqs` AND `book_exercises` (section_type='MCQ') as ONE pool, not two
// separate draws stacked together. This matters for the "never repeats
// until exhausted" guarantee to behave correctly across the combined set.
//
// used_questions_log still tracks each question under its own real
// source_table (mcqs vs book_exercises) — only the DRAW is merged, not
// the log. This keeps the log schema simple and keeps per-table reshuffle
// working correctly even inside a merged group.
// ============================================================

export interface MergedSourceMember {
  table: SourceTable
  /** Required when table === 'book_exercises'. */
  sectionType?: string
}

export interface MergedSourceRequest {
  /** Label used as the key in the result object, e.g. 'section_a_mcqs'. */
  key: string
  members: MergedSourceMember[]
  count: number
}

export interface MergedDrawParams {
  userId: string
  scope: DrawScope
  scopeId: string
  groups: MergedSourceRequest[]
}

export type MergedDrawResult = Record<string, any[]>

function asSourceRequest(member: MergedSourceMember): SourceRequest {
  return { table: member.table, count: 0, sectionType: member.sectionType }
}

async function fetchCandidateTuples(
  chapterIds: string[],
  member: MergedSourceMember
): Promise<{ table: SourceTable; id: string }[]> {
  const ids = await fetchCandidateIds(chapterIds, asSourceRequest(member))
  return ids.map(id => ({ table: member.table, id }))
}

async function fetchUsedTupleKeys(
  userId: string, scope: DrawScope, scopeId: string, member: MergedSourceMember
): Promise<Set<string>> {
  const used = await fetchUsedIds(userId, scope, scopeId, asSourceRequest(member))
  return new Set([...used].map(id => `${member.table}:${id}`))
}

export async function drawMergedQuestions(params: MergedDrawParams): Promise<MergedDrawResult> {
  const { userId, scope, scopeId, groups } = params
  const chapterIds = await resolveChapterIds(scope, scopeId)
  const result: MergedDrawResult = {}

  for (const group of groups) {
    const candidateTuplesPerMember = await Promise.all(
      group.members.map(m => fetchCandidateTuples(chapterIds, m))
    )
    const allCandidates = candidateTuplesPerMember.flat()

    const usedKeySetsPerMember = await Promise.all(
      group.members.map(m => fetchUsedTupleKeys(userId, scope, scopeId, m))
    )
    const usedKeys = new Set(usedKeySetsPerMember.flatMap(s => [...s]))

    let available = allCandidates.filter(c => !usedKeys.has(`${c.table}:${c.id}`))

    // Reshuffle: if the combined pool can't fulfill this draw, clear the
    // log for every member table in this group and start fresh.
    if (available.length < group.count) {
      await Promise.all(group.members.map(m => clearUsedLog(userId, scope, scopeId, asSourceRequest(m))))
      available = allCandidates
    }

    const drawn = shuffle(available).slice(0, Math.min(group.count, available.length))

    const drawnIdsByTable: Partial<Record<SourceTable, string[]>> = {}
    for (const d of drawn) {
      ;(drawnIdsByTable[d.table] ??= []).push(d.id)
    }

    await Promise.all(
      group.members.map(m => logUsedIds(userId, scope, scopeId, asSourceRequest(m), drawnIdsByTable[m.table] ?? []))
    )

    const rowsPerTable = await Promise.all(
      (Object.entries(drawnIdsByTable) as [SourceTable, string[]][]).map(
        async ([table, ids]) => fetchRowsByIds(table, ids)
      )
    )
    result[group.key] = rowsPerTable.flat()
  }

  return result
}
