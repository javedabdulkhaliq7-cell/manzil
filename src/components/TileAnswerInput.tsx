import { useEffect, useState } from 'react'
import FractionText from './FractionText'
import { tokenizeAnswer, shuffle } from '../lib/tileAnswer'

interface Tile {
  id: string
  text: string
}

export interface TileAnswerInputProps {
  /** The real answer text — tokenized internally into the target tile sequence. */
  correctAnswer: string
  /** Extra plausible-wrong term tiles mixed into the pool. Omit/empty for
   *  Learn tab (no decoys); pass real decoys for test screens. */
  decoyTiles?: string[]
  /** 'immediate' — tiles color as placed (Learn tab). 'onSubmit' — no
   *  color until Check is tapped, then locks (test screens). */
  feedback?: 'immediate' | 'onSubmit'
  /** Whether a wrong/incomplete attempt can be retried. Test screens may
   *  want this false once a test is submitted. */
  allowRetry?: boolean
  onResult?: (correct: boolean) => void
}

export default function TileAnswerInput({
  correctAnswer,
  decoyTiles = [],
  feedback = 'immediate',
  allowRetry = true,
  onResult,
}: TileAnswerInputProps) {
  const correctTiles = tokenizeAnswer(correctAnswer)

  const [pool, setPool] = useState<Tile[]>([])
  const [placed, setPlaced] = useState<Tile[]>([])
  const [checked, setChecked] = useState<'correct' | 'wrong' | null>(null)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    const all: Tile[] = shuffle([...correctTiles, ...decoyTiles]).map((text, i) => ({ id: `${i}-${text}`, text }))
    setPool(all)
    setPlaced([])
    setChecked(null)
    setLocked(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctAnswer])

  const place = (tile: Tile) => {
    if (locked) return
    setPool(p => p.filter(t => t.id !== tile.id))
    setPlaced(p => [...p, tile])
    setChecked(null)
  }

  const unplace = (tile: Tile) => {
    if (locked) return
    setPlaced(p => p.filter(t => t.id !== tile.id))
    setPool(p => [...p, tile])
    setChecked(null)
  }

  const reset = () => {
    setPool(shuffle([...placed, ...pool]))
    setPlaced([])
    setChecked(null)
    setLocked(false)
  }

  const check = () => {
    const correct = placed.length === correctTiles.length && placed.every((t, i) => t.text === correctTiles[i])
    setChecked(correct ? 'correct' : 'wrong')
    if (feedback === 'onSubmit' || correct) setLocked(true)
    onResult?.(correct)
  }

  // Live per-slot coloring for 'immediate' mode, or final coloring once
  // checked in 'onSubmit' mode.
  const slotState = (i: number): 'neutral' | 'correct' | 'wrong' => {
    const showColor = feedback === 'immediate' || checked !== null
    if (!showColor) return 'neutral'
    if (i >= correctTiles.length) return 'wrong'
    return placed[i]?.text === correctTiles[i] ? 'correct' : 'wrong'
  }

  const tileClass = (state: 'neutral' | 'correct' | 'wrong') =>
    state === 'correct'
      ? 'bg-emerald-100 border-emerald-400 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-700 dark:text-emerald-300'
      : state === 'wrong'
        ? 'bg-red-100 border-red-400 text-red-800 dark:bg-red-950/50 dark:border-red-700 dark:text-red-300'
        : 'bg-white border-gray-300 text-gray-800 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

  return (
    <div className="space-y-2">
      {/* Answer strip — tap a placed tile to remove it */}
      <div className="min-h-[2.5rem] flex flex-wrap items-center gap-1.5 p-2 rounded-lg border-2 border-dashed border-gray-200 dark:border-slate-700">
        {placed.length === 0 && (
          <span className="text-xs text-gray-400 dark:text-slate-500">Tap tiles below to build your answer...</span>
        )}
        {placed.map((tile, i) => (
          <button
            key={tile.id}
            onClick={() => unplace(tile)}
            disabled={locked}
            className={`px-2 py-1 rounded-md border text-sm font-semibold ${tileClass(slotState(i))} disabled:opacity-90`}
          >
            <FractionText text={tile.text} />
          </button>
        ))}
      </div>

      {/* Tile pool */}
      {pool.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pool.map(tile => (
            <button
              key={tile.id}
              onClick={() => place(tile)}
              disabled={locked}
              className="px-2 py-1 rounded-md border border-gray-300 bg-gray-50 text-sm font-semibold text-gray-700 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-200 disabled:opacity-40"
            >
              <FractionText text={tile.text} />
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={check}
          disabled={locked || placed.length === 0}
          className="text-xs font-bold text-white bg-brand-600 px-3 py-1.5 rounded-lg disabled:opacity-40"
        >
          Check
        </button>
        {checked === 'wrong' && allowRetry && (
          <button onClick={reset} className="text-xs font-bold text-gray-500 dark:text-slate-400">
            ↻ Try again
          </button>
        )}
        {checked === 'correct' && (
          <span className="text-xs font-bold text-emerald-600">✓ Correct!</span>
        )}
        {checked === 'wrong' && (
          <span className="text-xs font-bold text-red-500">Not quite — red tiles are out of place.</span>
        )}
      </div>
    </div>
  )
}
