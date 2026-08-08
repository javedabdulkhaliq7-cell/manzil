import { supabase } from './supabase'

export const MOCK_TEST_PRINT_DAILY_LIMIT = 3

/** Checks remaining prints today for this subject WITHOUT consuming one. */
export async function getMockTestPrintRemaining(userId: string, subjectId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_mocktest_print_remaining', {
    p_user_id: userId,
    p_subject_id: subjectId,
    p_daily_limit: MOCK_TEST_PRINT_DAILY_LIMIT,
  })
  if (error) throw error
  return data as number
}

/** Atomically consumes one print credit, if available. */
export async function tryUseMockTestPrint(userId: string, subjectId: string): Promise<{ allowed: boolean; remaining: number }> {
  const { data, error } = await supabase
    .rpc('try_use_mocktest_print', {
      p_user_id: userId,
      p_subject_id: subjectId,
      p_daily_limit: MOCK_TEST_PRINT_DAILY_LIMIT,
    })
    .single()
  if (error) throw error
  return data as { allowed: boolean; remaining: number }
}
