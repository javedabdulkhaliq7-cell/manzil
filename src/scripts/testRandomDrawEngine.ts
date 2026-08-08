// testRandomDrawEngine.ts
//
// Phase 1 verification script — per the plan doc: "Test the engine with
// direct queries/a scratch script before any screen uses it."
//
// NOT part of the app bundle. Run manually with:
//   npx tsx src/scripts/testRandomDrawEngine.ts
// (or ts-node, depending on what's already in your devDependencies)
//
// Before running: edit TEST_USER_ID and TEST_CHAPTER_ID below to match a
// real profile + chapter in your database that actually has content in
// mcqs/short_questions/etc, so the draw has something to pull from.

import { drawQuestions } from '../lib/randomDrawEngine'
import { supabase } from '../lib/supabase'

const TEST_USER_ID = 'PASTE-A-REAL-PROFILE-UUID-HERE'
const TEST_CHAPTER_ID = 'PASTE-A-REAL-CHAPTER-UUID-HERE'

async function main() {
  console.log('--- Phase 1 engine test ---')

  console.log('\n[1] Drawing 5 MCQs + 3 short questions for chapter scope...')
  const draw1 = await drawQuestions({
    userId: TEST_USER_ID,
    scope: 'chapter',
    scopeId: TEST_CHAPTER_ID,
    sources: [
      { table: 'mcqs', count: 5 },
      { table: 'short_questions', count: 3 },
    ],
  })
  console.log(`  mcqs drawn: ${draw1.mcqs?.length ?? 0}`)
  console.log(`  short_questions drawn: ${draw1.short_questions?.length ?? 0}`)
  const firstDrawMcqIds = (draw1.mcqs ?? []).map((m: any) => m.id)
  console.log(`  mcq ids: ${firstDrawMcqIds.join(', ')}`)

  console.log('\n[2] Drawing again immediately — should NOT overlap with draw 1 (until pool exhausted)...')
  const draw2 = await drawQuestions({
    userId: TEST_USER_ID,
    scope: 'chapter',
    scopeId: TEST_CHAPTER_ID,
    sources: [{ table: 'mcqs', count: 5 }],
  })
  const secondDrawMcqIds = (draw2.mcqs ?? []).map((m: any) => m.id)
  const overlap = secondDrawMcqIds.filter((id: string) => firstDrawMcqIds.includes(id))
  console.log(`  mcq ids: ${secondDrawMcqIds.join(', ')}`)
  console.log(`  overlap with draw 1: ${overlap.length} (expect 0, unless the chapter has fewer than 10 total MCQs — in which case reshuffle should have kicked in and some repeats are correct)`)

  console.log('\n[3] Checking used_questions_log row count for this user+chapter+mcqs...')
  const { data: logRows, error } = await supabase
    .from('used_questions_log')
    .select('*')
    .eq('user_id', TEST_USER_ID)
    .eq('scope', 'chapter')
    .eq('scope_id', TEST_CHAPTER_ID)
    .eq('source_table', 'mcqs')
  if (error) throw error
  console.log(`  logged rows: ${logRows?.length ?? 0}`)

  console.log('\n[4] Testing book_exercises with sectionType filter (MCQ)...')
  const draw3 = await drawQuestions({
    userId: TEST_USER_ID,
    scope: 'chapter',
    scopeId: TEST_CHAPTER_ID,
    sources: [{ table: 'book_exercises', count: 3, sectionType: 'MCQ' }],
  })
  console.log(`  book_exercises:MCQ drawn: ${draw3['book_exercises:MCQ']?.length ?? 0}`)

  console.log('\n--- Done. Inspect the numbers above against your chapter\'s real content counts. ---')
}

main().catch(err => {
  console.error('Test script failed:', err)
  process.exit(1)
})
