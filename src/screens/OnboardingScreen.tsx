import { useNavigate } from 'react-router-dom'
import { BookOpen, Brain, Trophy, Zap } from 'lucide-react'

export default function OnboardingScreen() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-brand-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">

        {/* Official IQRA brand logo — swaps between light/dark variants
            since the wordmark text is baked into the image as a fixed
            color and can't adapt via CSS alone. */}
        <img
          src="/brand/logo-full.png"
          alt="IQRA — Empowering Balochistan Through Education"
          className="w-48 mb-6 drop-shadow-xl block dark:hidden"
        />
        <img
          src="/brand/logo-full-dark.png"
          alt="IQRA — Empowering Balochistan Through Education"
          className="w-48 mb-6 drop-shadow-xl hidden dark:block"
        />

        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide uppercase mb-3 text-center">
          Balochistan Board · Class 9–12 · MDCAT
        </div>

        <p className="text-sm text-gray-500 text-center leading-relaxed max-w-xs mb-8 dark:text-slate-400">
          Quality exam prep built specifically for Balochistan Board students —
          MCQs, notes, mock tests, and AI tutor, all in one place.
        </p>

        <div className="grid grid-cols-2 gap-3 w-full max-w-xs mb-8">
          {[
            { icon: Brain,    label: 'AI Tutor',      color: 'bg-brand-50 text-brand-700 border border-brand-100 dark:bg-brand-950/40 dark:text-brand-400' },
            { icon: BookOpen, label: 'MCQ Bank',       color: 'bg-blue-50 text-blue-700 border border-blue-100 dark:bg-blue-950/30' },
            { icon: Trophy,   label: 'District Ranks', color: 'bg-amber-50 text-amber-700 border border-amber-100 dark:bg-amber-950/30' },
            { icon: Zap,      label: 'Mock Tests',     color: 'bg-violet-50 text-violet-700 border border-violet-100 dark:bg-violet-950/30' },
          ].map(({ icon: Icon, label, color }) => (
            <div key={label} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${color}`}>
              <Icon size={16} />
              <span className="text-xs font-semibold">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 pb-8 flex flex-col gap-3">
        <button
          onClick={() => navigate('/signup')}
          className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
        >
          Get Started Free 🚀
        </button>
        <button
          onClick={() => navigate('/login')}
          className="w-full bg-transparent border-2 border-brand-600 text-brand-700 dark:text-brand-400 font-bold py-3.5 rounded-2xl text-sm active:scale-95 transition-all"
        >
          Already Have an Account
        </button>
        <p className="text-center text-xs text-gray-400 mt-1 dark:text-slate-500">
          Free plan available · Premium from PKR 99/month
        </p>
      </div>
    </div>
  )
}