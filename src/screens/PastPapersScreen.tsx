import { useEffect, useState } from 'react'
import { Download, Eye, ChevronLeft, FileX } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase, Subject } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import GreenHero from '../components/GreenHero'
import FractionText from '../components/FractionText'

type Paper = {
  id: string
  subject_id: string
  title: string
  year: number
  board: string
  is_free: boolean
  is_predicted: boolean
  mcq_count: number
}

export default function PastPapersScreen() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null)
  const [papers, setPapers] = useState<Paper[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadSubjects() {
      const classLevel = profile?.class_level ?? 'Class 9'
      const { data } = await supabase.from('subjects').select('*').eq('class_level', classLevel).order('name')
      if (data && data.length > 0) {
        setSubjects(data)
        setActiveSubjectId(data[0].id)
      }
    }
    loadSubjects()
  }, [profile])

  useEffect(() => {
    async function load() {
      if (!activeSubjectId) { setLoading(false); return }
      setLoading(true)
      const { data } = await supabase
        .from('past_papers')
        .select('*')
        .eq('subject_id', activeSubjectId)
        .order('is_predicted', { ascending: false })
        .order('year', { ascending: false })
      if (data) setPapers(data)
      setLoading(false)
    }
    load()
  }, [activeSubjectId])

  const regularPapers = papers.filter(p => !p.is_predicted)
  const predictedPaper = papers.find(p => p.is_predicted)

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950">
      <GreenHero>
        <button onClick={() => navigate(-1)} className="text-brand-200 mb-2 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">📄</span>
          <div>
            <h1 className="text-xl font-black">Past Papers</h1>
            <p className="text-brand-100 text-xs">Balochistan Board · Class 9</p>
          </div>
        </div>
        {/* Subject filter */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {subjects.map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubjectId(sub.id)}
              className={`flex-shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-xl transition-all ${
                activeSubjectId === sub.id
                  ? 'bg-white text-brand-700 dark:bg-slate-800 dark:text-brand-400'
                  : 'bg-white/20 text-white'
              }`}
            >
              {sub.emoji} <FractionText text={sub.name} />
            </button>
          ))}
        </div>
      </GreenHero>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {/* AI Analysis */}
        <div className="bg-slate-900 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span>🤖</span>
            <span className="text-xs font-bold text-brand-400">AI Past Paper Analysis</span>
          </div>
          <div className="flex flex-col gap-2">
            {[
              'Cell Cycle appears in 90% of papers (2015–2025)',
              'Photosynthesis: most asked topic (avg 8 MCQs/paper)',
              '2026 likely to include Biotechnology chapter',
            ].map((tip, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-brand-400 text-xs">▸</span>
                <span className="text-xs text-slate-200 leading-relaxed">{tip}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Predicted paper */}
        {predictedPaper && (
          <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-300 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-12 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center text-xl flex-shrink-0">⭐</div>
              <div className="flex-1">
                <div className="text-xs font-black text-amber-900">Most Expected Paper 2026</div>
                <div className="text-[10px] text-amber-600">AI-predicted · Based on 10-year trends</div>
              </div>
              <span className="text-[9px] font-bold bg-amber-400 text-white px-2 py-1 rounded-full">PRO</span>
            </div>
          </div>
        )}

        {/* Paper list */}
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider dark:text-slate-500">Recent Papers</div>
        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {regularPapers.map(paper => (
          <div key={paper.id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 dark:bg-slate-800">
            <div className="w-10 h-12 bg-gradient-to-br from-brand-100 to-brand-50 dark:from-brand-950/50 dark:to-brand-900/30 rounded-lg flex items-center justify-center text-xl flex-shrink-0">📄</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100"><FractionText text={paper.title} /></div>
              <div className="text-xs text-gray-400 mt-0.5 dark:text-slate-500">Balochistan Board · {paper.mcq_count} MCQs</div>
            </div>
            {!paper.is_free && (
              <span className="text-[9px] bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 font-bold px-2 py-0.5 rounded-full flex-shrink-0">PRO</span>
            )}
            <div className="flex gap-2 flex-shrink-0">
              <button className="w-8 h-8 bg-brand-50 rounded-lg flex items-center justify-center text-brand-600 dark:bg-brand-950/40">
                <Eye size={14} />
              </button>
              <button className="w-8 h-8 bg-brand-50 rounded-lg flex items-center justify-center text-brand-600 dark:bg-brand-950/40">
                <Download size={14} />
              </button>
            </div>
          </div>
        ))}

        {!loading && regularPapers.length === 0 && (
          <div className="flex flex-col items-center text-center py-14 px-6">
            <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4 dark:bg-brand-950/40">
              <FileX className="text-brand-400" size={28} />
            </div>
            <div className="text-sm font-semibold text-gray-700 mb-1 dark:text-slate-300">No past papers here yet</div>
            <div className="text-xs text-gray-400 max-w-[220px] dark:text-slate-500">Check back soon — more papers are added regularly.</div>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
