import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Send, Bot } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, Chapter } from '../lib/supabase'
import { FREE_AI_LIMIT } from '../lib/constants'
import BottomNav from '../components/BottomNav'
import MarkdownText from '../components/MarkdownText'

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

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErrorMsg(data.error ?? 'Something went wrong. Please try again.')
        setMessages(prev => prev.slice(0, -1))
        setLoading(false)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')
      const decoder = new TextDecoder()
      let accumulated = ''
      let started = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        if (!started && accumulated.length > 0) {
          started = true
          setLoading(false)
          setMessages(prev => [...prev, { role: 'ai', text: accumulated }])
        } else if (started) {
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'ai', text: accumulated }
            return updated
          })
        }
      }

      if (!started) setLoading(false) // stream ended with no content — fall through, error banner or retry covers this
      await refreshProfile() // usage was already incremented server-side
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
      <div
        className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-5"
        style={{ background: 'radial-gradient(circle at 20% 0%, rgba(16,185,129,0.06), transparent 45%), radial-gradient(circle at 90% 30%, rgba(16,185,129,0.05), transparent 40%), #F9FAFB' }}
      >
        {messages.map((msg, i) => (
          msg.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-3xl rounded-tr-md px-4 py-3 text-xs leading-relaxed bg-gradient-to-br from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-900/10">
                {msg.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-2.5 items-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-600 to-emerald-500 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                <Bot size={14} className="text-white" />
              </div>
              <div className="max-w-[88%] rounded-3xl rounded-tl-md px-4 py-3.5 text-xs bg-white ring-1 ring-black/[0.04] shadow-sm shadow-black/[0.03] text-gray-800">
                <MarkdownText text={msg.text} />
              </div>
            </div>
          )
        ))}
        {loading && (
          <div className="flex gap-2.5 items-start">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-600 to-emerald-500 flex items-center justify-center flex-shrink-0">
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-white ring-1 ring-black/[0.04] rounded-3xl rounded-tl-md px-4 py-3.5 flex gap-1 shadow-sm">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 rounded-2xl text-center">
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
        <div className="px-4 pb-3 flex gap-2 overflow-x-auto flex-shrink-0 scrollbar-hide bg-[#F9FAFB]">
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => handleSend(s)}
              className="flex-shrink-0 bg-white ring-1 ring-emerald-200 text-emerald-700 text-[10px] font-semibold px-3 py-2 rounded-full shadow-sm hover:bg-emerald-50 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 bg-white border-t border-gray-100 flex-shrink-0">
        <div className="flex gap-2 items-center bg-gray-50 rounded-full pl-4 pr-1.5 py-1.5 ring-1 ring-gray-200 focus-within:ring-emerald-300 focus-within:bg-white transition-all">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={chapter ? `Ask anything about ${chapter.title}...` : 'Ask anything...'}
            disabled={aiUsed >= aiLimit}
            className="flex-1 bg-transparent text-xs focus:outline-none py-1.5"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading || aiUsed >= aiLimit}
            className="w-9 h-9 bg-gradient-to-br from-emerald-600 to-emerald-500 rounded-full flex items-center justify-center text-white disabled:opacity-40 flex-shrink-0 active:scale-95 transition-all"
          >
            <Send size={13} />
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
