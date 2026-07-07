import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Star, Zap, FileText, BookOpen, Bot, CheckCircle } from 'lucide-react'
import { supabase, Chapter, MCQ } from '../lib/supabase'
import BottomNav from '../components/BottomNav'

const TABS = [
  { id: 'notes',   label: '📝 Notes',      icon: BookOpen },
  { id: 'mcqs',    label: '🎯 MCQs',       icon: Zap },
  { id: 'quiz',    label: '⚡ Quiz',       icon: Zap },
  { id: 'past',    label: '📄 Papers',     icon: FileText },
  { id: 'ai',      label: '🤖 AI Tutor',  icon: Bot },
]

export default function ChapterDetailScreen() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const navigate = useNavigate()
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [mcqs, setMcqs] = useState<MCQ[]>([])
  const [activeTab, setActiveTab] = useState('notes')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: ch }, { data: qs }] = await Promise.all([
        supabase.from('chapters').select('*').eq('id', chapterId).single(),
        supabase.from('mcqs').select('*').eq('chapter_id', chapterId).limit(5),
      ])
      if (ch) setChapter(ch)
      if (qs) setMcqs(qs)
      setLoading(false)
    }
    load()
  }, [chapterId])

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-4 pt-4 pb-5 text-white flex-shrink-0">
        <button onClick={() => navigate(-1)} className="text-emerald-200 mb-2 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <h1 className="text-lg font-black">Ch {chapter?.number}: {chapter?.title}</h1>
        <p className="text-emerald-100 text-xs mt-0.5">Biology · Class 9 · Balochistan Board</p>
        <div className="flex gap-2 mt-2">
          {[`${chapter?.mcq_count ?? 0} MCQs`, '65% Done', '⭐ 4.8'].map(t => (
            <span key={t} className="bg-white/20 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full">{t}</span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto bg-white border-b border-gray-100 flex-shrink-0 scrollbar-hide">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-all border-b-2 ${
              activeTab === tab.id
                ? 'text-emerald-600 border-emerald-500'
                : 'text-gray-400 border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {activeTab === 'notes' && (
          <>
            {/* AI Summary */}
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">🤖</span>
                <span className="text-xs font-bold text-emerald-700">AI Summary</span>
                <span className="ml-auto text-[9px] bg-emerald-600 text-white px-2 py-0.5 rounded-full">Generated</span>
              </div>
              <p className="text-xs text-emerald-800 leading-relaxed">{chapter?.summary ?? 'Summary not available yet.'}</p>
            </div>

            {/* Key Points */}
            {chapter?.key_points && chapter.key_points.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <div className="text-xs font-bold text-slate-900 mb-3">🎯 Key Points</div>
                <div className="flex flex-col gap-2">
                  {chapter.key_points.map((pt, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <CheckCircle size={12} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-gray-700 leading-relaxed">{pt}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Important Topics */}
            {chapter?.important_topics && chapter.important_topics.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <div className="text-xs font-bold text-slate-900 mb-3">⭐ Important Topics</div>
                <div className="flex flex-wrap gap-2">
                  {chapter.important_topics.map((t, i) => (
                    <span key={i} className="bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-semibold px-2.5 py-1 rounded-full">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'mcqs' && (
          <>
            {mcqs.length === 0 && (
              <div className="text-center py-10 text-gray-400 text-sm">No MCQs available yet for this chapter.</div>
            )}
            {mcqs.map((mcq, i) => (
              <div key={mcq.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
                <div className="text-[10px] text-gray-400 font-semibold mb-2">Q{i + 1}</div>
                <p className="text-sm font-semibold text-slate-900 leading-snug mb-3">{mcq.question}</p>
                <div className="flex flex-col gap-2">
                  {(['A','B','C','D'] as const).map(opt => (
                    <div key={opt} className={`flex items-center gap-2 border rounded-xl px-3 py-2 text-xs ${
                      mcq.correct_option === opt ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-gray-100 text-gray-700'
                    }`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        mcq.correct_option === opt ? 'bg-emerald-500 text-white' : 'border border-gray-300'
                      }`}>{opt}</span>
                      {(mcq as any)[`option_${opt.toLowerCase()}`]}
                      {mcq.correct_option === opt && <span className="ml-auto text-emerald-500">✓</span>}
                    </div>
                  ))}
                </div>
                {mcq.explanation && (
                  <div className="mt-3 bg-emerald-50 rounded-xl p-3">
                    <span className="text-[10px] font-bold text-emerald-700">💡 Explanation: </span>
                    <span className="text-[10px] text-emerald-800">{mcq.explanation}</span>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {activeTab === 'quiz' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="text-5xl">⚡</div>
            <div className="text-center">
              <div className="font-bold text-slate-900 mb-1">Ready to Quiz?</div>
              <div className="text-xs text-gray-400">Test your knowledge on {chapter?.title}</div>
            </div>
            <button
              onClick={() => navigate(`/quiz/${chapterId}`)}
              className="bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all"
            >
              Start Chapter Quiz
            </button>
            <button
              onClick={() => navigate(chapter?.subject_id ? `/mock-test/${chapter.subject_id}` : '/mock-test')}
              className="border-2 border-emerald-600 text-emerald-700 font-bold px-8 py-3 rounded-2xl text-sm active:scale-95 transition-all"
            >
              Start Mock Test
            </button>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="text-5xl">🤖</div>
            <div className="text-center">
              <div className="font-bold text-slate-900 mb-1">AI Tutor Ready</div>
              <div className="text-xs text-gray-400">Ask anything about {chapter?.title}</div>
            </div>
            <button
              onClick={() => navigate(chapterId ? `/ai-tutor/${chapterId}` : '/ai-tutor')}
              className="bg-gradient-to-r from-slate-900 to-slate-800 text-emerald-400 font-bold px-8 py-3.5 rounded-2xl text-sm active:scale-95 transition-all"
            >
              Open AI Tutor
            </button>
          </div>
        )}

        {activeTab === 'past' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="text-5xl">📄</div>
            <div className="text-center">
              <div className="font-bold text-slate-900 mb-1">Past Papers</div>
              <div className="text-xs text-gray-400">Practice with real board exam papers</div>
            </div>
            <button
              onClick={() => navigate('/past-papers')}
              className="bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all"
            >
              View Past Papers
            </button>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
