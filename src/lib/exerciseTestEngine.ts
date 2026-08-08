// exerciseTestEngine.ts
//
// Phase 3 (see IQRA_NEW_FEATURES_AND_PHASES.md). Built on top of the
// Phase 1 drawQuestions() engine (randomDrawEngine.ts). Deliberately does
// NOT use drawMergedQuestions — Exercise Test's pool is book_exercises
// only, per section_type, never merged with mcqs/short_questions/etc.
// That merge behavior is Mock Test's (Phase 2), not this one.
//
// ASSUMPTIONS made explicit here (confirm against real schema):
//   - book_exercises has: id, chapter_id, section_type, question_number
//   - chapters has: id, subject_id, number
//   - profiles has: plan ('free' | 'premium')
// CONFIRMED against live schema (Aug 2026): section_type real values are
// 'MCQ' | 'Short' | 'Extended' | 'Numerical' | 'Practical'. 'Practical'
// is deliberately excluded below — those 5 rows are explicitly marked
// not-auto-gradable in their own `answer` field (lab demos, graph
// plotting, etc). Fill-in-Blank / True-False from the original Phase 3
// spec don't exist in book_exercises at all — dropped until real content
// exists.
//
// NOTE: getLiveSectionCounts/getFullExerciseTest were deliberately
// removed from this file. ChapterExerciseTestScreen.tsx already fetches
// every book_exercises row for the chapter on mount (that IS Full
// Exercise Test) — so Custom's counter maxes are just those already-
// loaded arrays' .length, no second query needed. Keeping a duplicate
// fetch function here would be dead code and a second source of truth.

import { supabase } from './supabase'
import { drawQuestions, type SourceRequest } from './randomDrawEngine'
import { checkAndConsumeCap, SHARED_PRINTABLE_FEATURE } from './dailyCap'

export type ExerciseSectionType = 'MCQ' | 'Short' | 'Extended' | 'Numerical'

// Typed errors so callers (the screen, the print view) can branch on
// WHAT went wrong without parsing message strings — message text can
// change for copy reasons without breaking anyone's error handling.
export class PlanGateError extends Error {}
export class DailyCapError extends Error {}
export class NoSelectionError extends Error {}

// ============================================================
// Free-tier gating: free plan only gets chapter 1 of any subject.
// ============================================================

interface PlanCheckResult {
  allowed: boolean
  isPremium: boolean
}

async function checkPlanForChapter(userId: string, chapterId: string): Promise<PlanCheckResult> {
  const [{ data: profile, error: profileErr }, { data: chapter, error: chapterErr }] = await Promise.all([
    supabase.from('profiles').select('plan').eq('id', userId).single(),
    supabase.from('chapters').select('number').eq('id', chapterId).single(),
  ])
  if (profileErr) throw profileErr
  if (chapterErr) throw chapterErr

  // Matches MockTestPrintView.tsx's exact check: plan === 'premium', not
  // "anything that isn't 'free'" — keep these two screens' gating logic
  // identical or they'll drift out of sync on a future third plan value.
  const isPremium = profile.plan === 'premium'
  const allowed = isPremium || chapter.number === 1
  return { allowed, isPremium }
}

// ============================================================
// Daily cap: free tier only, 3/subject/day, SHARED with Mock Test
// printable via SHARED_PRINTABLE_FEATURE (see dailyCap.ts) — using
// either feature counts against the same daily allowance for a subject.
// ============================================================

// ============================================================
// Custom Exercise Test — random draw from book_exercises only, per
// requested section-type counts, via the Phase 1 engine. Capped,
// gated, repeats allowed (small fixed pool per chapter, confirmed OK
// per spec — this still uses the engine's used-log/reshuffle behavior,
// it just means reshuffles will happen often on small chapters, which
// is expected and fine).
// ============================================================

export interface CustomExerciseRequest {
  userId: string
  subjectId: string
  chapterId: string
  /** Only include the section types the student actually wants; omit or set 0 to skip. */
  counts: Partial<Record<ExerciseSectionType, number>>
  /**
   * Optional sub-unit scope, e.g. "1.1" / "1.2" / "REVIEW" — Math only.
   * When present, every drawn section type is additionally filtered to
   * this unit_label (passed straight through to randomDrawEngine's
   * SourceRequest.unitLabel). Omit for whole-chapter draws — every
   * existing caller (Bio/Chem/Physics, whole-chapter Math) already omits
   * this, so behavior there is unchanged.
   */
  unitLabel?: string
}

export async function drawCustomExerciseTest(
  req: CustomExerciseRequest
): Promise<Record<ExerciseSectionType, any[]>> {
  const { userId, subjectId, chapterId, counts, unitLabel } = req

  const { allowed, isPremium } = await checkPlanForChapter(userId, chapterId)
  if (!allowed) {
    throw new PlanGateError('This chapter requires premium. Free plan includes chapter 1 of every subject.')
  }

  // Premium: unlimited, no cap check at all. Free tier (only ever on
  // chapter 1, per the gate above) IS capped — confirmed behavior, not
  // the inverse of what the original cross-cutting doc implied.
  if (!isPremium) {
    try {
      await checkAndConsumeCap(userId, subjectId, SHARED_PRINTABLE_FEATURE)
    } catch (e: any) {
      throw new DailyCapError(e?.message ?? 'Daily limit reached (3/subject/day). Try again after Pakistan midnight.')
    }
  }

  const sources: SourceRequest[] = Object.entries(counts)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([sectionType, count]) => ({
      table: 'book_exercises' as const,
      count: count as number,
      sectionType,
      ...(unitLabel ? { unitLabel } : {}),
    }))

  if (sources.length === 0) {
    throw new NoSelectionError('Select at least one section type.')
  }

  const result = await drawQuestions({
    userId,
    scope: 'chapter',
    scopeId: chapterId,
    sources,
  })

  // drawQuestions keys results as "book_exercises:SectionType" (see
  // resultKey in randomDrawEngine.ts) since sectionType is set on every
  // request here — remap to plain section-type keys for the UI.
  const remapped = {} as Record<ExerciseSectionType, any[]>
  for (const [key, rows] of Object.entries(result)) {
    const sectionType = key.split(':')[1] as ExerciseSectionType
    remapped[sectionType] = rows
  }

  return remapped
}
