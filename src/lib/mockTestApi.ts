import { supabase } from './supabase'

export type MockTestKind = 'chapter' | 'multi' | 'subject_mix' | 'all_mix' | 'exercise_student' | 'exercise_teacher'

export async function createMockTestRecord(params: {
  subjectId: string | null
  kind: MockTestKind
  chapterIds?: string[]
  recipe?: Record<string, unknown>
  questions: unknown[]
  totalMarks: number
  timeMinutes: number
}): Promise<string | null> {
  const { data, error } = await supabase.rpc('create_mock_test', {
    p_subject_id: params.subjectId,
    p_kind: params.kind,
    p_chapter_ids: params.chapterIds ?? [],
    p_recipe: params.recipe ?? {},
    p_questions: params.questions,
    p_total_marks: params.totalMarks,
    p_time_minutes: params.timeMinutes,
  })

  if (error) {
    console.error('create_mock_test RPC failed:', error)
    return null
  }

  return typeof data === 'string' ? data : data ?? null
}

export async function recordMockTestPrint(kind: 'question_paper' | 'answer_key', mockTestId?: string | null, subjectId?: string | null) {
  const { error } = await supabase.rpc('record_print', {
    p_kind: kind,
    p_mock_test_id: mockTestId ?? null,
    p_subject_id: subjectId ?? null,
  })

  if (error) {
    console.error('record_print RPC failed:', error)
  }
}
