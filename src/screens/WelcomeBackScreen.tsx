import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

// Shown once per login, for RETURNING users only — a brand-new signup
// still gets WelcomeMomentScreen ("You're in!") instead; see
// AuthCallbackScreen.tsx for the branch that decides which one fires.
// Deliberately lighter than WelcomeMomentScreen: no WhatsApp-invite
// follow-on, no "your account is ready" framing — just a quick
// name + "continue where you left off" beat before Home.
export default function WelcomeBackScreen() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  const name = profile?.full_name || profile?.name

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-brand-700 to-brand-500 px-6">
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mb-6">
          <span className="text-4xl">👋</span>
        </div>
        <h1 className="text-2xl font-bold text-white">
          {name ? `Welcome back, ${name}!` : 'Welcome back!'}
        </h1>
        <p className="text-brand-100 text-sm mt-2 max-w-xs">
          Continue your studies — pick up right where you left off.
        </p>
      </div>

      <div className="pb-10">
        <button
          onClick={() => navigate('/home')}
          className="w-full bg-white text-brand-700 font-bold py-4 rounded-2xl text-sm shadow-lg active:scale-95 transition-all"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
