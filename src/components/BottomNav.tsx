import { Home, BookOpen, Target, BarChart2, User } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'

const tabs = [
  { label: 'Home',  icon: Home,     path: '/home' },
  { label: 'Study', icon: BookOpen, path: '/subjects' },
  { label: 'Quiz',  icon: Target,   path: '/quiz' },
  { label: 'Stats', icon: BarChart2,path: '/progress' },
  { label: 'Me',    icon: User,     path: '/profile' },
]

export default function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <nav className="flex-shrink-0 bg-gradient-to-r from-emerald-800 to-emerald-600 flex items-center justify-around py-2 border-t border-emerald-700/50">
      {tabs.map(({ label, icon: Icon, path }) => {
        const active = pathname.startsWith(path)
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${
              active ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white/80'
            }`}
          >
            <Icon size={18} strokeWidth={active ? 2.5 : 1.8} />
            <span className={`text-[10px] font-${active ? '700' : '500'}`}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
