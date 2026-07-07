import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Send, Bot } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, Chapter } from '../lib/supabase'
import { FREE_AI_LIMIT } from '../lib/constants'
import BottomNav from '../components/BottomNav'

type Msg = { role: 'ai' | 'user'; text: string }

const DEFAULT_SUGGESTIONS = [
  'Explain this chapter in simple words',
  'Give me 3 practice MCQs',
  'What are the most important topics?',
  'Quiz me on this chapter',
]

export default function AiTutorScreen() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const { profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'ai', text: '👋 Salaam! I\'m your AI Tutor. Ask me anything about your current chapter — explanations, practice MCQs, or exam tips. What would you like to learn today?' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const today = new Date().toISOString().split('T')[0]
  const aiUsed = profile?.ai_reset_date === today ? (profile?.ai_used_today ?? 0) : 0
  const aiLimit = profile?.plan === 'free' ? FREE_AI_LIMIT : Infinity

  useEffect(() => {
    async function loadChapter() {
      if (!chapterId) return
      const { data } = await supabase.from('chapters').select('*').eq('id', chapterId).single()
      if (data) setChapter(data)
    }
    loadChapter()
  }, [chapterId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function handleSend(text?: string) {
    const msg = text ?? input
    if (!msg.trim()) return
    if (aiUsed >= aiLimit) return

    setMessages(prev => [...prev, { role: 'user', text: msg }])
    setInput('')
    setLoading(true)
    setErrorMsg('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const history = messages.slice(-8).map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.text,
      }))

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-tutor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ message: msg, chapterId, history }),
      })

      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.error ?? 'Something went wrong. Please try again.')
        setMessages(prev => prev.slice(0, -1)) // remove the user message that failed
      } else {
        setMessages(prev => [...prev, { role: 'ai', text: data.reply }])
        await refreshProfile() // usage was already incremented server-side
      }
    } catch (err) {
      setErrorMsg('Could not reach the AI Tutor. Check your connection and try again.')
      setMessages(prev => prev.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  const usedPct = aiLimit === Infinity ? 0 : (aiUsed / aiLimit) * 100
  const suggestions = chapter
    ? [`Explain ${chapter.title} in simple words`, 'Give me 3 practice MCQs', 'What are the most important topics?', 'Quiz me on this chapter']
    : DEFAULT_SUGGESTIONS

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 pt-4 pb-4 text-white flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate(-1)} className="text-emerald-200">
            <ChevronLeft size={20} />
          </button>
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <Bot size={20} />
          </div>
          <div className="flex-1">
            <div className="font-black text-base">AI Tutor</div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              <span className="text-xs text-emerald-100">Online · Syllabus-focused</span>
            </div>
          </div>
        </div>

        {/* Usage bar */}
        {profile?.plan === 'free' && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-emerald-100">Questions: {aiUsed}/{aiLimit} used</span>
              <span className="text-amber-300 font-bold">Free Plan</span>
            </div>
            <div className="h-1 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all" style={{ width: `${usedPct}%` }} />
            </div>
          </div>
        )}

        {chapter && (
          <div className="mt-2">
            <span className="bg-white/20 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full">
              📍 {profile?.class_level} · Ch {chapter.number}: {chapter.title}
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-xs leading-relaxed whitespace-pre-line ${
              msg.role === 'ai'
                ? 'bg-gray-100 text-gray-800 rounded-tl-sm'
                : 'bg-gradient-to-br from-emerald-600 to-emerald-500 text-white rounded-tr-sm'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 rounded-xl text-center">
            {errorMsg}
          </div>
        )}
        {aiUsed >= aiLimit && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <div className="font-bold text-amber-800 text-sm mb-1">Daily Limit Reached</div>
            <div className="text-xs text-amber-600 mb-3">Upgrade to Premium for unlimited AI Tutor access</div>
            <button onClick={() => navigate('/profile')} className="bg-amber-500 text-white text-xs font-bold px-4 py-2 rounded-xl">
              Upgrade to Premium
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 2 && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto flex-shrink-0 scrollbar-hide">
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => handleSend(s)}
              className="flex-shrink-0 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-semibold px-3 py-2 rounded-xl"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white flex gap-3 items-center flex-shrink-0">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder={chapter ? `Ask anything about ${chapter.title}...` : 'Ask anything...'}
          disabled={aiUsed >= aiLimit}
          className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || loading || aiUsed >= aiLimit}
          className="w-10 h-10 bg-gradient-to-br from-emerald-600 to-emerald-500 rounded-full flex items-center justify-center text-white disabled:opacity-40 flex-shrink-0 active:scale-95 transition-all"
        >
          <Send size={14} />
        </button>
      </div>

      <BottomNav />
    </div>
  )
}
