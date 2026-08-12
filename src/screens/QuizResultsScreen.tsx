import { useLocation, useNavigate } from 'react-router-dom'
import { Share2, RotateCcw, ChevronRight } from 'lucide-react'
import BottomNav from '../components/BottomNav'

type ResultState = {
  score: number
  total: number
  correct: number
  wrong: number
  skipped: number
  xpEarned: number
  timeTaken: number
}

function getGrade(score: number) {
  if (score >= 90) return { label: 'Excellent!', emoji: '🌟', color: 'text-brand-600' }
  if (score >= 75) return { label: 'Great Job!', emoji: '🎉', color: 'text-brand-600' }
  if (score >= 60) return { label: 'Good Work!', emoji: '👍', color: 'text-blue-600' }
  if (score >= 40) return { label: 'Keep Going!', emoji: '💪', color: 'text-amber-600' }
  return { label: 'Keep Practicing', emoji: '📚', color: 'text-red-600' }
}

export default function QuizResultsScreen() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const result = (state as ResultState) ?? { score: 85, total: 20, correct: 17, wrong: 2, skipped: 1, xpEarned: 170, timeTaken: 497 }
  const grade = getGrade(result.score)
  const circumference = 2 * Math.PI * 38
  const dashOffset = circumference * (1 - result.score / 100)
  const mins = Math.floor(result.timeTaken / 60)
  const secs = result.timeTaken % 60

  const aiRecs = [
    result.wrong > 0 ? 'Review the questions you got wrong with their explanations.' : null,
    result.score >= 80 ? 'You\'re ready for the Mock Test — try it now!' : 'Practice more MCQs on weak topics.',
    result.score < 60 ? 'Watch the chapter lecture to strengthen your understanding.' : 'Keep the streak going — quiz again tomorrow!',
  ].filter(Boolean) as string[]

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      {/* Hero */}
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 text-white px-4 pt-6 pb-8 text-center flex-shrink-0">
        <div className="text-3xl mb-1">{grade.emoji}</div>
        <h1 className="text-xl font-black">Quiz Complete!</h1>
        <p className="text-brand-100 text-xs mt-0.5">Biology · Cell Cycle · {result.total} Questions</p>

        {/* Score ring */}
        <div className="relative w-24 h-24 mx-auto mt-4">
          <svg width="96" height="96" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r="38" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
            <circle
              cx="48" cy="48" r="38" fill="none" stroke="white" strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 48 48)"
              className="transition-all duration-1000"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-black">{result.score}%</span>
            <span className="text-[10px] text-brand-100">{result.correct}/{result.total}</span>
          </div>
        </div>
      </div>

      {/* XP card floating */}
      <div className="px-4 -mt-4 z-10">
        <div className="bg-gradient-to-r from-amber-400 to-amber-500 rounded-2xl p-3 text-center shadow-lg shadow-amber-200">
          <div className="text-sm font-black text-white">+{result.xpEarned} ⭐ XP Earned!</div>
          <div className="text-[10px] text-amber-100">
            {result.score === 100 ? 'Perfect score bonus! ' : ''}
            {result.correct * 10} base + {result.score >= 80 ? '20 bonus (80%+)' : ''}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { val: result.correct, label: 'Correct',   bg: 'bg-brand-50 dark:bg-brand-950/40', text: 'text-brand-600' },
            { val: result.wrong,   label: 'Wrong',     bg: 'bg-red-50 dark:bg-red-950/40',     text: 'text-red-500' },
            { val: result.skipped, label: 'Skipped',   bg: 'bg-gray-50 dark:bg-slate-950',    text: 'text-gray-500 dark:text-slate-400' },
            { val: `${mins}:${secs.toString().padStart(2,'0')}`, label: 'Time', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-600' },
          ].map(({ val, label, bg, text }) => (
            <div key={label} className={`${bg} rounded-xl p-2 text-center`}>
              <div className={`text-sm font-black ${text}`}>{val}</div>
              <div className="text-[9px] text-gray-400 font-medium dark:text-slate-500">{label}</div>
            </div>
          ))}
        </div>

        {/* AI Recommendations */}
        <div className="bg-slate-900 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🤖</span>
            <span className="text-xs font-bold text-brand-400">AI Recommendations</span>
          </div>
          <div className="flex flex-col gap-2">
            {aiRecs.map((rec, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-brand-400 text-xs flex-shrink-0">▸</span>
                <span className="text-xs text-slate-200 leading-relaxed">{rec}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Performance grade */}
        <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4 dark:bg-slate-800">
          <div className="text-4xl">{grade.emoji}</div>
          <div>
            <div className={`text-base font-black ${grade.color}`}>{grade.label}</div>
            <div className="text-xs text-gray-400 mt-0.5 dark:text-slate-500">
              {result.score >= 80 ? 'Excellent performance! You\'re well prepared.' : 'Keep practicing to improve your score.'}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center justify-center gap-2 bg-transparent border-2 border-brand-600 text-brand-700 dark:text-brand-400 font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all"
          >
            <RotateCcw size={16} /> Try Again
          </button>
          <button className="flex items-center justify-center gap-2 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all">
            <Share2 size={16} /> Share Score
          </button>
        </div>

        <button
          onClick={() => navigate('/subjects')}
          className="flex items-center justify-between bg-white rounded-2xl shadow-sm p-4 active:scale-[0.99] transition-all dark:bg-slate-800"
        >
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Continue Studying</span>
          <ChevronRight size={18} className="text-brand-600" />
        </button>
      </div>

      <BottomNav />
    </div>
  )
}
