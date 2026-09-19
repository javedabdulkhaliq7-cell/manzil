import { useNavigate } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'

const WHATSAPP_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbDTRKyEquiSmUwrBc32'

// Screen 5 — placed right after the Welcome Moment, while trust is
// highest. A Channel invite (one-way broadcast), not a Group — no phone
// number collected, tap opens WhatsApp directly to the Join screen.
// Skippable, but visible.
export default function WhatsAppPromptScreen() {
  const navigate = useNavigate()

  function handleJoin() {
    window.open(WHATSAPP_CHANNEL_URL, '_blank')
    navigate('/home')
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-slate-950 px-6">
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#25D366]/15 flex items-center justify-center mb-6">
          <MessageCircle size={30} className="text-[#25D366]" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          Get exam alerts, past paper drops &amp; scholarship news first
        </h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-2 max-w-xs">
          Where do toppers get their news first? Here.
        </p>
      </div>

      <div className="pb-10 flex flex-col gap-3">
        <button
          onClick={handleJoin}
          className="w-full flex items-center justify-center gap-2 bg-[#25D366] text-white font-bold py-4 rounded-2xl text-sm shadow-lg active:scale-95 transition-all"
        >
          <MessageCircle size={18} />
          Get Exam Alerts
        </button>
        <button
          onClick={() => navigate('/home')}
          className="text-sm font-semibold text-gray-400 dark:text-slate-500"
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
