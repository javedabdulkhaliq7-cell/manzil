import { useEffect, useState } from 'react'
import { Download, Eye, ChevronLeft } from 'lucide-react'
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
    <div className="flex flex-col h-screen bg-gray-50">
      <GreenHero>
        <button onClick={() => navigate(-1)} className="text-emerald-200 mb-2 flex items-center gap-1 text-xs">
          <ChevronLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">📄</span>
          <div>
            <h1 className="text-xl font-black">Past Papers</h1>
            <p className="text-emerald-100 text-xs">Balochistan Board · Class 9</p>
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
                  ? 'bg-white text-emerald-700'
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
            <span className="text-xs font-bold text-emerald-400">AI Past Paper Analysis</span>
          </div>
          <div className="flex flex-col gap-2">
            {[
              'Cell Cycle appears in 90% of papers (2015–2025)',
              'Photosynthesis: most asked topic (avg 8 MCQs/paper)',
              '2026 likely to include Biotechnology chapter',
            ].map((tip, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-emerald-400 text-xs">▸</span>
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
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Recent Papers</div>
        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {regularPapers.map(paper => (
          <div key={paper.id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-12 bg-gradient-to-br from-emerald-100 to-emerald-50 rounded-lg flex items-center justify-center text-xl flex-shrink-0">📄</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900"><FractionText text={paper.title} /></div>
              <div className="text-xs text-gray-400 mt-0.5">Balochistan Board · {paper.mcq_count} MCQs</div>
            </div>
            {!paper.is_free && (
              <span className="text-[9px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full flex-shrink-0">PRO</span>
            )}
            <div className="flex gap-2 flex-shrink-0">
              <button className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600">
                <Eye size={14} />
              </button>
              <button className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600">
                <Download size={14} />
              </button>
            </div>
          </div>
        ))}

        {!loading && regularPapers.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">No past papers available yet.</div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
