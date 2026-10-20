// Topic checkpoint panel (Class 11/12 notes). Every question of an attempt must be answered
// correctly, one after another. A wrong answer keeps all progress: the student stays on the SAME
// question and answers it again until it is right.
// The server decides what is correct — this component only shows what the server replies and
// never knows the answer (the correct answer is never shown, even after a wrong one).
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import FractionText from '../FractionText'
import type { CheckpointEngine, CheckpointQuestion, StartResult } from '../../lib/seniorNotesApi'

type Phase = 'idle' | 'starting' | 'asking' | 'submitting' | 'correct' | 'passed' | 'noquestions'

const CORRECT_PAUSE_MS = 900
const NETWORK_ERROR = "Couldn't reach the server — try again"

type Props = {
  chapterId: string
  /** Where questions come from and answers go: the server when online, the downloaded pack when offline. */
  engine: CheckpointEngine
  topicKey: string
  /** Title of the next topic, for the pass screen; null when this is the last topic. */
  nextTitle: string | null
  /** The pass screen's Continue button: parent refreshes progress and moves to the next topic. */
  onContinue: (topicKey: string) => void
  /** The topic has no questions: it counts as done on screen (no server record). */
  onNoQuestions: (topicKey: string) => void
  /** "Review notes" after a wrong answer: parent shows and scrolls to this topic's notes. */
  onReviewNotes: (topicKey: string) => void
}

export default function CheckpointPanel({ chapterId, engine, topicKey, nextTitle, onContinue, onNoQuestions, onReviewNotes }: Props) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [index, setIndex] = useState(0)
  const [question, setQuestion] = useState<CheckpointQuestion | null>(null)
  const [parts, setParts] = useState<string[]>([]) // one entry per word tile
  const [focused, setFocused] = useState<number | null>(null) // tile that has the keyboard
  const [hint, setHint] = useState<{ explanation: string | null } | null>(null) // shown after a wrong try
  const [wrongTry, setWrongTry] = useState(false) // tiles are red until the student edits them
  const [earned, setEarned] = useState<{ points: number; pending: boolean } | null>(null) // score for passing this topic
  const [banner, setBanner] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const tileRefs = useRef<Array<HTMLInputElement | null>>([])
  const lock = useRef(false) // blocks a double-tap while a request is in flight
  const timer = useRef<number | null>(null)

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }
  useEffect(() => clearTimer, [])

  /** Show a question from a started/resumed attempt. */
  const showAttempt = useCallback((r: Extract<StartResult, { attempt_id: string }>) => {
    setAttemptId(r.attempt_id)
    setTotal(r.total)
    setIndex(r.index)
    setQuestion(r.question)
    setHint(null)
    setWrongTry(false)
    setBanner(null)
    setNotice(null)
    setPhase('asking')
  }, [])

  // The questions load straight away: a new attempt is started, or the unfinished one is picked up
  // at the same question (nothing is reset). The server decides which.
  useEffect(() => {
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, topicKey])

  // One tile per word of the answer (the server sends each word's letter count in `blanks`)
  const tileLengths: number[] = question && question.blanks.length > 0 ? question.blanks : [8]
  const tileCount = tileLengths.length
  const lastTile = tileCount - 1
  const answerText = parts.join(' ').replace(/\s+/g, ' ').trim()

  const focusTile = (i: number) =>
    window.requestAnimationFrame(() => {
      const el = tileRefs.current[Math.max(0, Math.min(i, lastTile))]
      el?.focus()
    })

  // Empty tiles for every new question (a failed network send keeps what was typed)
  useEffect(() => {
    setParts(Array.from({ length: tileCount }, () => ''))
  }, [question?.id, tileCount])

  // Keyboard opens automatically on the first empty tile
  useEffect(() => {
    if (phase !== 'asking') return
    const firstEmpty = parts.findIndex((p) => p === '')
    focusTile(firstEmpty === -1 ? lastTile : firstEmpty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index])

  /** Typing in tile i. A tile takes exactly as many characters as its answer word has (blanks[i]);
   *  a space, or filling the tile, moves on to the next tile; pasted words spread across the tiles. */
  function onTileChange(i: number, raw: string) {
    if (wrongTry) setWrongTry(false)
    const next = Array.from({ length: tileCount }, (_, k) => parts[k] ?? '')
    const fit = (text: string, k: number) => Array.from(text).slice(0, tileLengths[k]).join('')

    if (!/\s/.test(raw)) {
      const value = fit(raw, i)
      next[i] = value
      setParts(next)
      if (value.length >= tileLengths[i] && Array.from(raw).length > Array.from(parts[i] ?? '').length && i < lastTile) {
        focusTile(i + 1) // tile is full: carry on in the next one
      }
      return
    }

    const words = raw.split(/\s+/).filter(Boolean)
    if (words.length === 0) return // only spaces typed: ignore
    words.forEach((word, k) => {
      const target = i + k
      if (target <= lastTile) next[target] = fit(word, target) // words beyond the last tile are dropped
    })
    setParts(next)
    focusTile(/\s$/.test(raw) ? i + words.length : i + words.length - 1)
  }

  function onTileKeyDown(i: number, e: { key: string; preventDefault(): void; currentTarget: HTMLInputElement }) {
    const el = e.currentTarget
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Backspace' && el.value === '' && i > 0) {
      e.preventDefault()
      focusTile(i - 1)
    } else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && i > 0) {
      e.preventDefault()
      focusTile(i - 1)
    } else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length && i < lastTile) {
      e.preventDefault()
      focusTile(i + 1)
    }
  }

  async function start() {
    if (lock.current) return
    lock.current = true
    setBanner(null)
    setNotice(null)
    setPhase('starting')
    try {
      const r = await engine.start(topicKey)
      switch (r.status) {
        case 'started':
        case 'resumed':
          showAttempt(r)
          break
        case 'no_questions':
          setPhase('noquestions')
          break
        case 'already_passed':
          onContinue(topicKey)
          setPhase('idle')
          break
        case 'no_pack':
          setNotice("This chapter's questions weren't downloaded. Connect to the internet, or download the chapter again while online.")
          setPhase('idle')
          break
        case 'locked':
          setNotice('Finish the earlier topic first.')
          setPhase('idle')
          break
        default:
          setNotice("This topic isn't available right now.")
          setPhase('idle')
      }
    } catch {
      setBanner(NETWORK_ERROR)
      setPhase('idle')
    } finally {
      lock.current = false
    }
  }

  async function submit() {
    const answer = answerText
    if (lock.current || phase !== 'asking' || !question || !attemptId || answer === '') return
    lock.current = true
    setBanner(null)
    setPhase('submitting')
    try {
      const r = await engine.submit(attemptId, question.id, answer)
      switch (r.status) {
        case 'continue':
          setPhase('correct')
          clearTimer()
          timer.current = window.setTimeout(() => {
            setIndex(r.index)
            setTotal(r.total)
            setQuestion(r.question)
            setHint(null)
            setWrongTry(false)
            setPhase('asking')
          }, CORRECT_PAUSE_MS)
          break
        case 'passed':
          setEarned({ points: r.points ?? 0, pending: !!r.pending })
          setPhase('correct')
          clearTimer()
          timer.current = window.setTimeout(() => setPhase('passed'), CORRECT_PAUSE_MS)
          break
        case 'wrong':
          // same question, nothing is reset; the typed letters stay so a typo can be fixed
          setHint({ explanation: r.explanation })
          setWrongTry(true)
          setPhase('asking')
          break
        case 'invalid_answer':
          setBanner('Please type an answer.')
          setPhase('asking')
          break
        default:
          // wrong_question / attempt_closed / invalid_attempt: this attempt is no longer valid
          setAttemptId(null)
          setQuestion(null)
          setNotice('That attempt has ended. Start again when you are ready.')
          setPhase('idle')
      }
    } catch {
      setBanner(NETWORK_ERROR) // typed text is kept
      setPhase('asking')
    } finally {
      lock.current = false
    }
  }

  /* ----------------------------------------------------------------------- render */

  if (phase === 'starting') {
    return (
      <div className="rounded-2xl border border-brand-200 bg-white p-4 flex items-center justify-center gap-2 dark:border-brand-800 dark:bg-slate-800" role="status">
        <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-gray-500 dark:text-slate-400">Loading questions…</span>
      </div>
    )
  }

  if (phase === 'noquestions') {
    return (
      <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 text-center dark:border-brand-800 dark:bg-brand-950/20">
        <p className="text-xs text-gray-600 dark:text-slate-300 mb-3">There are no questions for this topic yet.</p>
        <button
          type="button"
          onClick={() => onNoQuestions(topicKey)}
          className="w-full min-h-[44px] bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold text-xs rounded-xl active:scale-95 transition-all"
        >
          Continue
        </button>
      </div>
    )
  }

  if (phase === 'idle') {
    return (
      <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-800 dark:bg-brand-950/20">
        <p role="alert" className="text-xs text-gray-700 dark:text-slate-300 mb-3 leading-relaxed">
          {banner ?? notice ?? "Couldn't load the questions."}
        </p>
        <button
          type="button"
          onClick={start}
          className="w-full min-h-[44px] bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold text-xs rounded-xl active:scale-95 transition-all"
        >
          Try again
        </button>
      </div>
    )
  }

  if (phase === 'passed') {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-center dark:border-emerald-700 dark:bg-emerald-950/30" role="status">
        <CheckCircle size={32} className="mx-auto text-emerald-600 dark:text-emerald-400 mb-1" />
        <div className="text-sm font-black text-emerald-800 dark:text-emerald-300">Topic complete</div>
        {earned && earned.points > 0 && (
          <div className="mt-1.5">
            <span className="inline-block rounded-full bg-emerald-600 px-3 py-1 text-xs font-black text-white">+{earned.points} score</span>
            {earned.pending && (
              <p className="mt-1 text-[10px] text-emerald-700 dark:text-emerald-300">Added to your score when you're back online.</p>
            )}
          </div>
        )}
        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1 mb-3">
          {nextTitle ? <>Next: <FractionText text={nextTitle} /></> : 'That was the last topic of this chapter.'}
        </p>
        <button
          type="button"
          onClick={() => onContinue(topicKey)}
          className="w-full min-h-[44px] bg-emerald-600 text-white font-bold text-xs rounded-xl active:scale-95 transition-all"
        >
          Continue
        </button>
      </div>
    )
  }

  // asking | submitting | correct
  const isCorrect = phase === 'correct'
  const busy = phase === 'submitting'
  const tileTone = isCorrect
    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
    : wrongTry
      ? 'border-red-400 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200'
      : 'border-gray-300 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 focus-within:border-brand-500'

  return (
    <div className="rounded-2xl border border-brand-200 bg-white p-4 dark:border-brand-800 dark:bg-slate-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-brand-700 dark:text-brand-400" aria-live="polite">
          Question {index + 1} of {total}
        </span>
        <div className="flex gap-1" aria-hidden="true">
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} className={`w-5 h-1.5 rounded-full ${i < index || (isCorrect && i === index) ? 'bg-emerald-500' : i === index ? 'bg-brand-500' : 'bg-gray-200 dark:bg-slate-600'}`} />
          ))}
        </div>
      </div>

      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-relaxed mb-2">
        <FractionText text={question?.question ?? ''} />
      </p>

      <div className="flex flex-wrap gap-2 mb-1" role="group" aria-label="Type one word in each box">
        {tileLengths.map((len, i) => {
          const value = parts[i] ?? ''
          const letters = Array.from(value)
          const slots = len // one underline per letter of the answer word
          const active = focused === i && !busy && !isCorrect
          return (
            <div
              key={i}
              style={{ flex: `${Math.max(len, 2)} 1 64px` }}
              className={`relative min-w-0 min-h-[56px] rounded-xl border-2 px-2 pt-2 pb-2 flex items-end gap-1 ${tileTone}`}
            >
              {Array.from({ length: slots }).map((_, k) => {
                const ch = letters[k]
                const isNext = active && k === letters.length
                return (
                  <span
                    key={k}
                    aria-hidden="true"
                    className={`flex-1 min-w-0 h-9 flex items-end justify-center border-b-[3px] pb-0.5 font-mono text-lg font-semibold leading-none ${
                      isCorrect
                        ? 'border-emerald-500'
                        : wrongTry
                          ? 'border-red-500'
                          : ch !== undefined && ch !== ''
                          ? 'border-slate-700 dark:border-slate-200'
                          : isNext
                            ? 'border-brand-500 animate-pulse'
                            : 'border-gray-300 dark:border-slate-600'
                    }`}
                  >
                    {ch === ' ' ? '\u00a0' : ch}
                  </span>
                )
              })}
              {/* The real input sits invisibly on top, so typing, paste, backspace and the phone keyboard work normally */}
              <input
                ref={(el) => {
                  tileRefs.current[i] = el
                }}
                type="text"
                value={value}
                onChange={(e) => onTileChange(i, e.target.value)}
                onKeyDown={(e) => onTileKeyDown(i, e)}
                onFocus={(e) => {
                  setFocused(i)
                  const end = e.target.value.length
                  e.target.setSelectionRange(end, end)
                }}
                onBlur={() => setFocused((f) => (f === i ? null : f))}
                disabled={busy || isCorrect}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint={i === lastTile ? 'send' : 'next'}
                aria-label={`Word ${i + 1} of ${tileCount}, ${len} letters`}
                className="absolute inset-0 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent opacity-0 outline-none"
              />
            </div>
          )
        })}
        {isCorrect && <CheckCircle size={22} className="self-center text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
      </div>

      {hint && !isCorrect && (
        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30" role="alert">
          <div className="flex items-center gap-1.5">
            <XCircle size={16} className="text-red-600 dark:text-red-400 flex-shrink-0" aria-hidden="true" />
            <span className="text-xs font-black text-red-700 dark:text-red-300">Not quite — try this question again</span>
          </div>
          {hint.explanation && (
            <p className="mt-1 text-xs text-red-800 dark:text-red-200 leading-relaxed">
              <FractionText text={hint.explanation} />
            </p>
          )}
          <button
            type="button"
            onClick={() => onReviewNotes(topicKey)}
            className="mt-2 min-h-[36px] px-3 rounded-lg bg-white text-brand-700 border border-brand-200 text-[11px] font-bold dark:bg-slate-800 dark:text-brand-400 dark:border-slate-700"
          >
            Review notes
          </button>
        </div>
      )}

      <div className="min-h-[20px] mt-1.5" aria-live="polite">
        {isCorrect && <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Correct</span>}
        {banner && !isCorrect && (
          <span className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400" role="alert">
            <AlertCircle size={12} /> {banner}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={busy || isCorrect || answerText === ''}
        className="w-full min-h-[44px] mt-1 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold text-xs rounded-xl disabled:opacity-50 active:scale-95 transition-all"
      >
        {busy ? 'Checking…' : 'Submit'}
      </button>
    </div>
  )
}
