import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Star, Zap, FileText, BookOpen, Bot, CheckCircle, ClipboardList, Lock, GraduationCap, ImageOff } from 'lucide-react'
import { supabase, Chapter } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import ChapterExerciseTab from './ChapterExerciseTab'
import LearnTab from './LearnTab'
import FractionText from '../components/FractionText'
import DiagramRenderer from '../components/DiagramRenderer'

// Chapter joined with its real subject name + class level, so the header
// reflects which subject/class this actually is instead of a fixed string.
type ChapterWithSubject = Chapter & { subjects?: { name: string; class_level: string } | null }

const TABS = [
  { id: 'notes',    label: '📝 Notes',      icon: BookOpen },
  { id: 'mocktest', label: '📝 Mock Test',  icon: ClipboardList },
  { id: 'quiz',     label: '⚡ Quiz',       icon: Zap },
  { id: 'exercise', label: '📖 Exercise',   icon: ClipboardList },
  { id: 'learn',    label: '🎓 Learn',      icon: GraduationCap },
  { id: 'past',     label: '📄 Papers',     icon: FileText },
  { id: 'ai',       label: '🤖 AI Tutor',  icon: Bot },
]

export default function ChapterDetailScreen() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [chapter, setChapter] = useState<ChapterWithSubject | null>(null)
  const [activeTab, setActiveTab] = useState('notes')
  const [loading, setLoading] = useState(true)

  const isPremium = profile?.plan === 'premium'
  const isLockedForUser = !!chapter?.is_locked && !isPremium

  useEffect(() => {
    async function load() {
      const { data: ch } = await supabase.from('chapters').select('*, subjects(name, class_level)').eq('id', chapterId).single()
      if (ch) setChapter(ch as ChapterWithSubject)
      setLoading(false)
    }
    load()
  }, [chapterId])

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 items-center justify-center dark:bg-slate-950">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isLockedForUser) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
        <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 pt-4 pb-5 text-white flex-shrink-0">
          <button onClick={() => navigate(-1)} className="text-brand-200 mb-2 flex items-center gap-1 text-xs">
            <ChevronLeft size={14} /> Back
          </button>
          <h1 className="text-lg font-black">Ch {chapter?.number}: {chapter?.title}</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center dark:bg-slate-700">
            <Lock size={26} className="text-gray-400 dark:text-slate-500" />
          </div>
          <div>
            <div className="font-bold text-slate-900 mb-1 dark:text-slate-100">This chapter is Premium</div>
            <div className="text-xs text-gray-400 dark:text-slate-500">Upgrade to unlock every chapter, MCQ, and mock test across all subjects.</div>
          </div>
          <button
            onClick={() => navigate('/profile')}
            className="bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
          >
            Upgrade to Premium
          </button>
        </div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      {/* Hero */}
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-4 pt-4 pb-5 text-white flex-shrink-0">
        <button onClick={() => navigate(-1)} className="text-brand-200 mb-2 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <h1 className="text-lg font-black">Ch {chapter?.number}: {chapter?.title}</h1>
        <p className="text-brand-100 text-xs mt-0.5">{chapter?.subjects?.name ?? 'Subject'} · {chapter?.subjects?.class_level ?? ''} · Balochistan Board</p>
        <div className="flex gap-2 mt-2">
          {[`${chapter?.mcq_count ?? 0} MCQs`].map(t => (
            <span key={t} className="bg-white/20 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full">{t}</span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto bg-white border-b border-gray-100 flex-shrink-0 scrollbar-hide dark:bg-slate-800 dark:border-slate-700">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-all border-b-2 ${
              activeTab === tab.id
                ? 'text-brand-600 border-brand-500'
                : 'text-gray-400 border-transparent dark:text-slate-500'
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
            {/* Summary */}
            <div className="bg-gradient-to-br from-brand-50 to-brand-100/50 dark:from-slate-950 dark:to-brand-950/30 border border-brand-200 dark:border-brand-800 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">📗</span>
                <span className="text-xs font-bold text-brand-700 dark:text-brand-400">Summary</span>
              </div>
              <p className="text-xs text-brand-800 dark:text-brand-200 leading-relaxed dark:text-brand-300"><FractionText text={chapter?.summary ?? 'Summary not available yet.'} /></p>
            </div>

            {/* Detailed Notes — unified flow of numbered bullet/table sections */}
            {chapter?.detailed_notes && chapter.detailed_notes.length > 0 && chapter.detailed_notes.map((section: any, i: number) => (
              <div key={i} className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
                {section.title && (
                  <div className="text-xs font-bold text-slate-900 mb-3 dark:text-slate-100"><FractionText text={section.title} /></div>
                )}
                {section.type === 'bullets' && (
                  <div className="flex flex-col gap-1.5">
                    {section.items.map((item: string, j: number) => (
                      <div key={j} className="flex items-start gap-2">
                        <span className="text-brand-500 text-xs flex-shrink-0 mt-0.5">→</span>
                        <span className="text-xs text-gray-700 leading-relaxed dark:text-slate-300"><FractionText text={item} /></span>
                      </div>
                    ))}
                  </div>
                )}
                {section.type === 'table' && (
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-slate-700">
                          {section.columns.map((col: any, k: number) => (
                            <th key={k} className="text-left font-bold text-gray-500 px-1.5 py-1.5 align-top dark:text-slate-400">
                              {typeof col === 'string' ? col : JSON.stringify(col)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map((row: string[], r: number) => (
                          <tr key={r} className="border-b border-gray-50 last:border-0">
                            {row.map((cell: string, c: number) => (
                              <td key={c} className="text-gray-700 px-1.5 py-1.5 align-top dark:text-slate-300"><FractionText text={cell} /></td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {section.type === 'diagram' && (
                  <DiagramRenderer
                    diagramType={section.diagram_type}
                    diagramData={section.diagram_data}
                    caption={section.caption}
                  />
                )}
                {section.type === 'timeline' && (
                  <ol className="relative border-s-2 border-brand-200 dark:border-brand-800 ps-4 flex flex-col gap-3">
                    {section.items.map((item: { date: string; event: string }, t: number) => (
                      <li key={t} className="relative">
                        <span className="absolute -start-[21px] top-0.5 w-3 h-3 rounded-full bg-brand-500 ring-4 ring-white dark:ring-slate-800" />
                        <div className="text-[10px] font-bold text-brand-600 dark:text-brand-400"><FractionText text={item.date} /></div>
                        <div className="text-xs text-gray-700 leading-relaxed dark:text-slate-300"><FractionText text={item.event} /></div>
                      </li>
                    ))}
                  </ol>
                )}
                {section.type === 'image_needed' && section.needed && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-slate-600 dark:bg-slate-900/50">
                    <ImageOff size={16} className="text-gray-400 flex-shrink-0 mt-0.5 dark:text-slate-500" />
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-gray-500 uppercase dark:text-slate-400">
                        {section.image_type ? `${section.image_type} needed` : 'Image needed'}
                      </div>
                      {section.caption && (
                        <div className="text-xs text-gray-600 mt-0.5 leading-relaxed dark:text-slate-300"><FractionText text={section.caption} /></div>
                      )}
                      {section.suggested_source && (
                        <div className="text-[10px] text-gray-400 italic mt-1 dark:text-slate-500">Source: {section.suggested_source}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Exam Weight — same table styling, pulled from important_topics */}
            {chapter?.important_topics && chapter.important_topics.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
                <div className="text-xs font-bold text-slate-900 mb-3 dark:text-slate-100">Exam Weight by Topic</div>
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-slate-700">
                      <th className="text-left font-bold text-gray-500 px-1.5 py-1.5 dark:text-slate-400">Topic</th>
                      <th className="text-left font-bold text-gray-500 px-1.5 py-1.5 dark:text-slate-400">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chapter.important_topics.map((t: any, i: number) => {
                      const weightColors: Record<string, string> = {
                        HIGH: 'text-red-600', MEDIUM: 'text-amber-600', LOW: 'text-gray-500 dark:text-slate-400',
                      }
                      return (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="text-gray-700 px-1.5 py-1.5 dark:text-slate-300"><FractionText text={t.topic} /></td>
                          <td className={`font-bold px-1.5 py-1.5 ${weightColors[t.weight] ?? ''}`}>
                            {typeof t.weight === 'string' ? t.weight : JSON.stringify(t.weight)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Glossary — same table styling */}
            {chapter?.glossary && chapter.glossary.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
                <div className="text-xs font-bold text-slate-900 mb-3 dark:text-slate-100">Glossary</div>
                <table className="w-full text-[11px] border-collapse">
                  <tbody>
                    {chapter.glossary.map((g: any, i: number) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="font-bold text-slate-800 px-1.5 py-1.5 align-top whitespace-nowrap dark:text-slate-100"><FractionText text={g.term} /></td>
                        <td className="text-gray-600 px-1.5 py-1.5 dark:text-slate-300"><FractionText text={g.definition} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Important Notes — merges Key Points + Common Mistakes + Mnemonics into one closing section */}
            {((chapter?.key_points?.length ?? 0) > 0 || (chapter?.common_mistakes?.length ?? 0) > 0 || (chapter?.mnemonics?.length ?? 0) > 0) && (
              <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800">
                <div className="text-xs font-bold text-slate-900 mb-3 dark:text-slate-100">⭐ Important Notes</div>
                <div className="flex flex-col gap-1.5">
                  {chapter?.key_points?.map((pt, i) => (
                    <div key={`kp-${i}`} className="flex items-start gap-2">
                      <CheckCircle size={12} className="text-brand-500 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-gray-700 leading-relaxed dark:text-slate-300"><FractionText text={pt} /></span>
                    </div>
                  ))}
                  {chapter?.common_mistakes?.map((m: any, i: number) => (
                    <div key={`cm-${i}`} className="flex items-start gap-2">
                      <CheckCircle size={12} className="text-brand-500 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-gray-700 leading-relaxed dark:text-slate-300"><FractionText text={m.correct} /></span>
                    </div>
                  ))}
                </div>
                {chapter?.mnemonics && chapter.mnemonics.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-2 dark:text-slate-500">Quick Memory Tricks</div>
                    <div className="flex flex-col gap-1.5">
                      {chapter.mnemonics.map((mn: any, i: number) => (
                        <div key={i} className="text-xs text-gray-700 dark:text-slate-300">
                          <span className="font-bold text-slate-800 dark:text-slate-100"><FractionText text={mn.concept} /></span> → <span className="italic"><FractionText text={mn.mnemonic} /></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'mocktest' && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="text-5xl">📝</div>
            <div className="text-center">
              <div className="font-bold text-slate-900 mb-1 dark:text-slate-100">Ready for a Mock Test?</div>
              <div className="text-xs text-gray-400 dark:text-slate-500">Timed, self-check test covering MCQs, Short, Long &amp; Numericals for {chapter?.title}</div>
            </div>
            <button
              onClick={() => navigate(`/mock-test/chapter/${chapterId}`)}
              className="bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
            >
              Start Mock Test
            </button>
            <button
              onClick={() => navigate(`/mock-test/chapter/${chapterId}/print`)}
              className="bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
            >
              🖨️ Print a Practice Paper
            </button>
          </div>
        )}

        {activeTab === 'quiz' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="text-5xl">⚡</div>
            <div className="text-center">
              <div className="font-bold text-slate-900 mb-1 dark:text-slate-100">Ready to Quiz?</div>
              <div className="text-xs text-gray-400 dark:text-slate-500">Test your knowledge on {chapter?.title}</div>
            </div>
            <button
              onClick={() => navigate(`/quiz/${chapterId}`)}
              className="bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
            >
              Start Chapter Quiz
            </button>
          </div>
        )}

        {activeTab === 'exercise' && chapterId && (
          <ChapterExerciseTab chapterId={chapterId} />
        )}
        {activeTab === 'learn' && chapterId && (
          <LearnTab chapterId={chapterId} />
        )}

        {activeTab === 'ai' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="text-5xl">🤖</div>
            <div className="text-center">
              <div className="font-bold text-slate-900 mb-1 dark:text-slate-100">AI Tutor Ready</div>
              <div className="text-xs text-gray-400 dark:text-slate-500">Ask anything about {chapter?.title}</div>
            </div>
            <button
              onClick={() => navigate(chapterId ? `/ai-tutor/${chapterId}` : '/ai-tutor')}
              className="bg-gradient-to-r from-slate-900 to-slate-800 text-brand-400 font-bold px-8 py-3.5 rounded-2xl text-sm active:scale-95 transition-all"
            >
              Open AI Tutor
            </button>
          </div>
        )}

        {activeTab === 'past' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="text-5xl">📄</div>
            <div className="text-center">
              <div className="font-bold text-slate-900 mb-1 dark:text-slate-100">Past Papers</div>
              <div className="text-xs text-gray-400 dark:text-slate-500">Practice with real board exam papers</div>
            </div>
            <button
              onClick={() => navigate('/past-papers')}
              className="bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold px-8 py-3.5 rounded-2xl text-sm shadow-lg shadow-brand-200 active:scale-95 transition-all"
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
