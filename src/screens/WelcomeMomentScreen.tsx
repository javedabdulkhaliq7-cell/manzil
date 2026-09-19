import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

// Screen 4 — the highest-trust moment in the flow, right after account
// creation. Not skippable, but not delayed either — one tap through.
// Google signups have a name already (pulled from the Google profile in
// AuthCallbackScreen); email-code signups don't collect a name at this
// stage, so this gracefully falls back to a name-less greeting.
export default function WelcomeMomentScreen() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  const name = profile?.full_name || profile?.name

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-brand-700 to-brand-500 px-6">
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mb-6">
          <span className="text-4xl">🎉</span>
        </div>
        <h1 className="text-2xl font-bold text-white">
          {name ? `You're in! Welcome, ${name}` : "You're in! Welcome to IQRA"}
        </h1>
        <p className="text-brand-100 text-sm mt-2 max-w-xs">
          Your account is ready — let's get your first quiz started.
        </p>
      </div>

      <div className="pb-10">
        <button
          onClick={() => navigate('/whatsapp-invite')}
          className="w-full bg-white text-brand-700 font-bold py-4 rounded-2xl text-sm shadow-lg active:scale-95 transition-all"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
