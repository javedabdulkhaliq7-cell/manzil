import { ReactNode } from 'react'

export default function GreenHero({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-gradient-to-br from-emerald-700 to-emerald-500 text-white px-4 pt-4 pb-5 flex-shrink-0 ${className}`}>
      {children}
    </div>
  )
}
