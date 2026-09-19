import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GraduationCap, Stethoscope } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const CLASSES = [
  { label: 'Class 8',  icon: GraduationCap, value: 'Class 8',  subjects: '6 Subjects',  live: false },
  { label: 'Class 9',  icon: GraduationCap, value: 'Class 9',  subjects: '6 Subjects',  live: true  },
  { label: 'Class 10', icon: GraduationCap, value: 'Class 10', subjects: '8 Subjects',  live: true  },
  { label: 'Class 11', icon: GraduationCap, value: 'Class 11', subjects: '6 Subjects',  live: false },
  { label: 'Class 12', icon: GraduationCap, value: 'Class 12', subjects: '6 Subjects',  live: false },
  { label: 'MDCAT',    icon: Stethoscope,   value: 'MDCAT',    subjects: 'Pro Plan',    live: false, isMdcat: true },
]

const PENDING_CLASS_KEY = 'iqra_pending_class'

export default function ClassSelectionScreen() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  // Pre-auth (no user yet): always first-time, never a "switch" — even if a
  // pick was stashed in localStorage from a previous visit to this step.
  const isSwitching = !!user && !!profile?.class_level
  const [selected, setSelected] = useState(
    profile?.class_level ?? localStorage.getItem(PENDING_CLASS_KEY) ?? 'Class 9'
  )
  const [loading, setLoading] = useState(false)
  const [showComingSoon, setShowComingSoon] = useState(false)
  const [confirming, setConfirming] = useState(false)

  function handleSelect(cls: typeof CLASSES[0]) {
    if (!cls.live) {
      setShowComingSoon(true)
      setTimeout(() => setShowComingSoon(false), 2500)
      return
    }
    setSelected(cls.value)
    setShowComingSoon(false)
    setConfirming(false)
  }

  async function commitClassChange() {
    if (!user) {
      // Pre-auth: nothing to write yet — stash the pick and let Signup pick
      // it up once an account (and a user id) actually exists.
      localStorage.setItem(PENDING_CLASS_KEY, selected)
      navigate('/signup')
      return
    }
    setLoading(true)
    await supabase.from('profiles').update({ class_level: selected }).eq('id', user.id)
    await refreshProfile()
    setLoading(false)
    navigate('/home')
  }

  function handleContinue() {
    // Switching to a different class than the one already set — confirm first,
    // since this changes what the student sees on Home/Chapters/Mock Test
    // immediately. First-time onboarding (no class_level yet) and re-picking
    // the same class need no confirmation.
    if (isSwitching && selected !== profile?.class_level && !confirming) {
      setConfirming(true)
      return
    }
    commitClassChange()
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-5 pt-10 pb-6 text-white flex-shrink-0">
        {isSwitching ? (
          <>
            <h1 className="text-2xl font-bold">Switch Class</h1>
            <p className="text-brand-100 text-sm mt-1">You can switch back anytime from here</p>
          </>
        ) : (
          <>
            <div className="text-xs font-semibold text-brand-200 mb-1">Step 1 of 2</div>
            <h1 className="text-2xl font-bold">Select Your Class</h1>
            <p className="text-brand-100 text-sm mt-1">Choose your class to get personalised content</p>
          </>
        )}
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
          const Icon = cls.icon
          const iconColor = cls.isMdcat ? 'text-white' : isSelected ? 'text-white' : 'text-brand-600 dark:text-brand-400'
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

              <Icon size={28} className={`mx-auto mb-1 ${iconColor}`} />
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

      {/* Confirm before switching away from current class */}
      {confirming && (
        <div className="mx-4 mt-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 text-xs font-semibold text-brand-800 text-center dark:bg-brand-950/30">
          You'll now see {selected} content. Switch back to {profile?.class_level} anytime from Me → My Board & Class.
        </div>
      )}

      <div className="p-4 flex-shrink-0 bg-white border-t border-gray-100 dark:bg-slate-800 dark:border-slate-700">
        <button
          onClick={handleContinue}
          disabled={loading}
          className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 disabled:opacity-60 active:scale-95 transition-all"
        >
          {loading
            ? 'Saving...'
            : confirming
            ? `Confirm Switch to ${selected} →`
            : isSwitching
            ? `Switch to ${selected} →`
            : `Continue with ${selected} →`}
        </button>
        <p className="text-center text-[10px] text-gray-400 mt-2 dark:text-slate-500">More classes launching soon</p>
      </div>
    </div>
  )
}