import { useMemo, useState } from 'react'
import FractionText from './FractionText'
import { parseRubric, gradeAgainstRubric, RubricGradeResult } from '../lib/rubricGrading'

export interface WrittenAnswerInputProps {
  /** The book/model answer text, revealed after grading. */
  correctAnswer: string
  /** Raw DB `rubric` value — shape is validated internally. When it's a
   *  genuine [{concept,keywords,points}] array, the answer is auto-graded
   *  by keyword match. Any other shape (string, object, null, malformed)
   *  falls back to student self-assessment. */
  rubric?: unknown
  /** This question's total marks — auto-grade scores are scaled to this. */
  maxMarks: number
  /** Whether a below-full-marks attempt can be retried. Test screens may
   *  want this false once a test is submitted. Defaults true. */
  allowRetry?: boolean
  onResult?: (result: RubricGradeResult) => void
}

export default function WrittenAnswerInput({
  correctAnswer,
  rubric,
  maxMarks,
  allowRetry = true,
  onResult,
}: WrittenAnswerInputProps) {
  const concepts = useMemo(() => parseRubric(rubric), [rubric])

  const [answer, setAnswer] = useState('')
  const [checked, setChecked] = useState(false)
  const [result, setResult] = useState<RubricGradeResult | null>(null)
  const [locked, setLocked] = useState(false)

  const emit = (r: RubricGradeResult) => {
    setResult(r)
    setChecked(true)
    if (!allowRetry || r.score >= r.max) setLocked(true)
    onResult?.(r)
  }

  const checkAgainstRubric = () => {
    if (!concepts) return
    emit(gradeAgainstRubric(answer, concepts, maxMarks))
  }

  const selfGrade = (correct: boolean) => {
    emit({ score: correct ? maxMarks : 0, max: maxMarks, hits: [], studentAnswer: answer })
  }

  const tryAgain = () => {
    setAnswer('')
    setChecked(false)
    setResult(null)
    setLocked(false)
  }

  return (
    <div className="space-y-2">
      <textarea
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        disabled={locked || checked}
        placeholder="Write your answer here..."
        rows={4}
        className="w-full text-sm rounded-lg border-2 border-gray-200 p-2.5 text-slate-800 placeholder:text-gray-400 focus:outline-none focus:border-brand-400 disabled:opacity-70 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
      />

      {!checked && concepts && (
        <button
          onClick={checkAgainstRubric}
          disabled={answer.trim().length === 0}
          className="text-xs font-bold text-white bg-brand-600 px-3 py-1.5 rounded-lg disabled:opacity-40"
        >
          Check Answer
        </button>
      )}

      {!checked && !concepts && (
        <button
          onClick={() => setChecked(true)}
          disabled={answer.trim().length === 0}
          className="text-xs font-bold text-white bg-brand-600 px-3 py-1.5 rounded-lg disabled:opacity-40"
        >
          Show Model Answer
        </button>
      )}

      {checked && (
        <div className="space-y-2">
          <div className="bg-brand-50 border border-brand-100 rounded-xl p-2.5 dark:bg-brand-950/40">
            <div className="text-[9px] font-bold text-brand-700 mb-0.5 dark:text-brand-400">✅ Model Answer</div>
            <div className="text-[11px] text-brand-800 leading-relaxed dark:text-brand-300"><FractionText text={correctAnswer} /></div>
          </div>

          {/* Auto-graded: rubric matched — show per-concept hits + score */}
          {result && concepts && (
            <div className="space-y-1.5">
              <div className="flex flex-col gap-1">
                {result.hits.map((h, i) => (
                  <div key={i} className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg ${h.matched ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'}`}>
                    <span>{h.matched ? '✓' : '✗'}</span>
                    <span className="flex-1">{h.concept}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-brand-600">{result.score} / {result.max} marks</span>
                {result.score < result.max && allowRetry && (
                  <button onClick={tryAgain} className="text-xs font-bold text-gray-500 dark:text-slate-400">↻ Try again</button>
                )}
              </div>
            </div>
          )}

          {/* No usable rubric — self-assessment fallback */}
          {result && !concepts && (
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold ${result.score >= result.max ? 'text-emerald-600' : 'text-red-500'}`}>
                {result.score >= result.max ? '✓ Marked correct' : '✗ Marked incorrect'}
              </span>
              {result.score < result.max && allowRetry && (
                <button onClick={tryAgain} className="text-xs font-bold text-gray-500 dark:text-slate-400">↻ Try again</button>
              )}
            </div>
          )}

          {!result && !concepts && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-gray-500 dark:text-slate-400">How did you do?</span>
              <button
                onClick={() => selfGrade(true)}
                className="text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-lg dark:bg-emerald-950/50 dark:text-emerald-300"
              >
                ✓ Got it right
              </button>
              <button
                onClick={() => selfGrade(false)}
                className="text-xs font-bold text-red-700 bg-red-100 px-3 py-1.5 rounded-lg dark:bg-red-950/50 dark:text-red-300"
              >
                ✗ Missed it
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
