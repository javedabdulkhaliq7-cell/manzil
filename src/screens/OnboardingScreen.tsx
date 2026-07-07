import { useNavigate } from 'react-router-dom'
import { BookOpen, Brain, Trophy, Zap } from 'lucide-react'

export default function OnboardingScreen() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-emerald-50 to-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="text-7xl mb-5">📚</div>
        <div className="text-xs font-bold text-emerald-600 tracking-widest uppercase mb-3 text-center">
          Balochistan Board · Class 8–12 · MDCAT
        </div>
        <h1 className="text-3xl font-black text-slate-900 text-center leading-tight mb-3">
          Study Smarter,{' '}
          <span className="bg-gradient-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent">
            Score Higher
          </span>
        </h1>
        <p className="text-sm text-gray-500 text-center leading-relaxed max-w-xs mb-8">
          Pakistan's first AI-powered study app built for Balochistan Board students. Learn smarter, rank higher — at PKR 99/month.
        </p>

        <div className="grid grid-cols-2 gap-3 w-full max-w-xs mb-8">
          {[
            { icon: Brain,    label: 'AI Tutor 24/7',    color: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
            { icon: BookOpen, label: 'MCQ Bank',          color: 'bg-blue-50 text-blue-700 border border-blue-100' },
            { icon: Trophy,   label: 'District Ranks',    color: 'bg-amber-50 text-amber-700 border border-amber-100' },
            { icon: Zap,      label: 'Mock Tests',        color: 'bg-violet-50 text-violet-700 border border-violet-100' },
          ].map(({ icon: Icon, label, color }) => (
            <div key={label} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${color}`}>
              <Icon size={16} />
              <span className="text-xs font-700 font-semibold">{label}</span>
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
          Already Have Account
        </button>
        <p className="text-center text-xs text-gray-400 mt-1">
          No credit card required · Free forever plan available
        </p>
      </div>
    </div>
  )
}
