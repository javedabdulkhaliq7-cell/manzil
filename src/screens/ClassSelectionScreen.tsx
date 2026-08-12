import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const CLASSES = [
  { label: 'Class 8',  emoji: '8️⃣',   value: 'Class 8',  subjects: '6 Subjects',  live: false },
  { label: 'Class 9',  emoji: '9️⃣',   value: 'Class 9',  subjects: '6 Subjects',  live: true  },
  { label: 'Class 10', emoji: '🔟',   value: 'Class 10', subjects: '6 Subjects',  live: false },
  { label: 'Class 11', emoji: '1️⃣1️⃣', value: 'Class 11', subjects: '6 Subjects',  live: false },
  { label: 'Class 12', emoji: '1️⃣2️⃣', value: 'Class 12', subjects: '6 Subjects',  live: false },
  { label: 'MDCAT',    emoji: '🩺',   value: 'MDCAT',    subjects: 'Pro Plan',    live: false, isMdcat: true },
]

export default function ClassSelectionScreen() {
  const { user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [selected, setSelected] = useState('Class 9')
  const [loading, setLoading] = useState(false)
  const [showComingSoon, setShowComingSoon] = useState(false)

  function handleSelect(cls: typeof CLASSES[0]) {
    if (!cls.live) {
      setShowComingSoon(true)
      setTimeout(() => setShowComingSoon(false), 2500)
      return
    }
    setSelected(cls.value)
    setShowComingSoon(false)
  }

  async function handleContinue() {
    if (!user) return
    setLoading(true)
    await supabase.from('profiles').update({ class_level: selected }).eq('id', user.id)
    await refreshProfile()
    setLoading(false)
    navigate('/home')
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-5 pt-10 pb-6 text-white flex-shrink-0">
        <div className="text-xs font-semibold text-brand-200 mb-1">Step 1 of 2</div>
        <h1 className="text-2xl font-black">Select Your Class</h1>
        <p className="text-brand-100 text-sm mt-1">Choose your class to get personalised content</p>
      </div>

      {/* Coming soon toast */}
      {showComingSoon && (
        <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs font-semibold text-amber-800 text-center transition-all dark:bg-amber-950/30">
          ⏳ This class is coming soon — Class 9 is live now!
        </div>
      )}

      <div className="flex-1 p-4 grid grid-cols-2 gap-3 content-start">
        {CLASSES.map(cls => {
          const isSelected = selected === cls.value
          const isLive = cls.live
          return (
            <button
              key={cls.value}
              onClick={() => handleSelect(cls)}
              className={`relative rounded-2xl p-4 text-center transition-all active:scale-95 ${
                cls.isMdcat
                  ? 'bg-slate-900 border-2 border-slate-700 opacity-60'
                  : !isLive
                  ? 'bg-white border-2 border-gray-100 shadow-sm opacity-50 dark:bg-slate-800 dark:border-slate-700'
                  : isSelected
                  ? 'bg-gradient-to-br from-brand-600 to-brand-500 shadow-lg shadow-brand-200 border-2 border-brand-400'
                  : 'bg-white border-2 border-gray-100 shadow-sm hover:border-brand-200 dark:bg-slate-800 dark:border-slate-700'
              }`}
            >
              {/* Live badge */}
              {isLive && !isSelected && (
                <span className="absolute top-2 right-2 bg-brand-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full">
                  LIVE
                </span>
              )}
              {isSelected && !cls.isMdcat && (
                <span className="absolute top-2 right-2 bg-white text-brand-600 text-[9px] font-black px-2 py-0.5 rounded-full dark:bg-slate-800">
                  ✓ Selected
                </span>
              )}
              {!isLive && !cls.isMdcat && (
                <span className="absolute top-2 right-2 bg-gray-100 text-gray-400 text-[8px] font-bold px-1.5 py-0.5 rounded-full dark:bg-slate-700 dark:text-slate-500">
                  Soon
                </span>
              )}

              <div className="text-3xl mb-1">{cls.emoji}</div>
              <div className={`text-sm font-bold ${cls.isMdcat ? 'text-white' : isSelected ? 'text-white' : 'text-slate-900 dark:text-slate-100'}`}>
                {cls.label}
              </div>
              <div className={`text-xs mt-0.5 ${cls.isMdcat ? 'text-brand-400' : isSelected ? 'text-brand-100' : 'text-gray-400 dark:text-slate-500'}`}>
                {cls.subjects}
              </div>
            </button>
          )
        })}
      </div>

      <div className="p-4 flex-shrink-0 bg-white border-t border-gray-100 dark:bg-slate-800 dark:border-slate-700">
        <button
          onClick={handleContinue}
          disabled={loading}
          className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 disabled:opacity-60 active:scale-95 transition-all"
        >
          {loading ? 'Saving...' : `Continue with ${selected} →`}
        </button>
        <p className="text-center text-[10px] text-gray-400 mt-2 dark:text-slate-500">More classes launching soon</p>
      </div>
    </div>
  )
}