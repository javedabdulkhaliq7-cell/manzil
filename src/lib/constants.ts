export const SUBJECT_COLORS: Record<string, { bg: string; border: string; text: string; pill: string }> = {
  bio:  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', pill: 'bg-emerald-100 text-emerald-700' },
  chem: { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-800',    pill: 'bg-blue-100 text-blue-700' },
  phy:  { bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-800',  pill: 'bg-orange-100 text-orange-700' },
  math: { bg: 'bg-violet-50',  border: 'border-violet-200',  text: 'text-violet-800',  pill: 'bg-violet-100 text-violet-700' },
  eng:  { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-800',     pill: 'bg-red-100 text-red-700' },
  urdu: { bg: 'bg-teal-50',    border: 'border-teal-200',    text: 'text-teal-800',    pill: 'bg-teal-100 text-teal-700' },
}

export const RANKS = [
  { name: 'Beginner',  minXp: 0,      color: 'text-gray-500',    badge: '⚪' },
  { name: 'Student',   minXp: 500,    color: 'text-amber-700',   badge: '🟤' },
  { name: 'Scholar',   minXp: 2000,   color: 'text-gray-400',    badge: '⚪' },
  { name: 'Topper',    minXp: 5000,   color: 'text-yellow-500',  badge: '🟡' },
  { name: 'Champion',  minXp: 15000,  color: 'text-slate-400',   badge: '🔵' },
  { name: 'Legend',    minXp: 50000,  color: 'text-cyan-400',    badge: '💎' },
]

export function getRank(xp: number) {
  let rank = RANKS[0]
  for (const r of RANKS) {
    if (xp >= r.minXp) rank = r
  }
  return rank
}

export const FREE_MCQ_LIMIT = 20
export const FREE_AI_LIMIT = 10
