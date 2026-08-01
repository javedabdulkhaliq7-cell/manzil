import { useNavigate } from 'react-router-dom'
import { BookOpen, Brain, Trophy, Zap } from 'lucide-react'

export default function OnboardingScreen() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-emerald-50 to-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">

        {/* Logo mark */}
        <div className="w-24 h-24 mb-6 drop-shadow-xl">
          <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <rect width="64" height="64" rx="14" fill="#059669"/>
            {/* Head */}
            <circle cx="32" cy="14" r="7" fill="white"/>
            {/* Shoulders */}
            <line x1="20" y1="28" x2="44" y2="28" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            {/* Left arm down */}
            <line x1="20" y1="28" x2="20" y2="42" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            {/* Left forearm inward */}
            <line x1="20" y1="42" x2="30" y2="42" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            {/* Right arm down */}
            <line x1="44" y1="28" x2="44" y2="42" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            {/* Right forearm inward */}
            <line x1="44" y1="42" x2="34" y2="42" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            {/* Book left page */}
            <rect x="22" y="34" width="9" height="11" rx="1" fill="white" opacity="0.95"/>
            {/* Book right page */}
            <rect x="33" y="34" width="9" height="11" rx="1" fill="white" opacity="0.65"/>
            {/* Book spine */}
            <line x1="32" y1="34" x2="32" y2="45" stroke="#059669" strokeWidth="1.5"/>
            {/* iqra text */}
            <text x="32" y="58" fontFamily="Arial,sans-serif" fontSize="12" fontWeight="700" fill="white" textAnchor="middle">iqra</text>
          </svg>
        </div>

        <div className="text-xs font-bold text-emerald-600 tracking-widest uppercase mb-3 text-center">
          Balochistan Board · Class 9–12 · MDCAT
        </div>

        <h1 className="text-3xl font-black text-slate-900 text-center leading-tight mb-2">
          Read. Learn. Rise.
        </h1>
        <h2 className="text-4xl font-black text-center mb-4">
          <span className="bg-gradient-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent">
            Iqra
          </span>
        </h2>

        <p className="text-sm text-gray-500 text-center leading-relaxed max-w-xs mb-8">
          Quality exam prep built specifically for Balochistan Board students —
          MCQs, notes, mock tests, and AI tutor, all in one place.
        </p>

        <div className="grid grid-cols-2 gap-3 w-full max-w-xs mb-8">
          {[
            { icon: Brain,    label: 'AI Tutor',      color: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
            { icon: BookOpen, label: 'MCQ Bank',       color: 'bg-blue-50 text-blue-700 border border-blue-100' },
            { icon: Trophy,   label: 'District Ranks', color: 'bg-amber-50 text-amber-700 border border-amber-100' },
            { icon: Zap,      label: 'Mock Tests',     color: 'bg-violet-50 text-violet-700 border border-violet-100' },
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
          className="w-full bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all"
        >
          Get Started Free 🚀
        </button>
        <button
          onClick={() => navigate('/login')}
          className="w-full border-2 border-emerald-600 text-emerald-700 font-bold py-3.5 rounded-2xl text-sm active:scale-95 transition-all"
        >
          Already Have an Account
        </button>
        <p className="text-center text-xs text-gray-400 mt-1">
          Free plan available · Premium from PKR 99/month
        </p>
      </div>
    </div>
  )
}