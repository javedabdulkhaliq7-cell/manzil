import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'

export default function LoginScreen() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin() {
    if (!email || !password) { setError('Please fill in all fields'); return }
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) { setError(err.message); return }
    navigate('/home')
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-brand-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-6 pt-12 pb-10 text-white">
        <img src="/brand/icon-white-bg.png" alt="IQRA" className="w-20 h-20 rounded-2xl mb-4 shadow-lg" />
        <h1 className="text-2xl font-black">Welcome Back</h1>
        <p className="text-brand-100 text-sm mt-1">Sign in to continue your studies</p>
      </div>

      <div className="flex-1 px-6 pt-8 flex flex-col gap-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl dark:bg-red-950/40">
            {error}
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block dark:text-slate-300">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" size={16} />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="student@example.com"
              className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block dark:text-slate-300">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" size={16} />
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-200 rounded-xl pl-10 pr-10 py-3 text-sm text-slate-900 bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500">
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 disabled:opacity-60 active:scale-95 transition-all mt-2"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        <div className="text-center">
          <span className="text-sm text-gray-500 dark:text-slate-400">Don't have an account? </span>
          <button onClick={() => navigate('/signup')} className="text-sm font-semibold text-brand-600">
            Sign Up
          </button>
        </div>
      </div>
    </div>
  )
}
