import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Mail, Lock, User, MapPin } from 'lucide-react'

const DISTRICTS = ['Quetta','Turbat','Gwadar','Khuzdar','Zhob','Sibi','Loralai','Kharan','Nushki','Chaman','Hub','Kalat','Mastung','Panjgur']

export default function SignupScreen() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', district: 'Quetta' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function update(key: string, val: string) { setForm(f => ({ ...f, [key]: val })) }

  async function handleSignup() {
    if (!form.fullName || !form.email || !form.password) { setError('Please fill in all fields'); return }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true); setError('')
    const { data, error: err } = await supabase.auth.signUp({ email: form.email, password: form.password })
    if (err) { setError(err.message); setLoading(false); return }
    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        full_name: form.fullName,
        name: form.fullName,
        district: form.district,
        class_level: 'Class 9',
        board: 'balochistan',
        plan: 'free',
      })
    }
    setLoading(false)
    navigate('/onboarding-class')
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-brand-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-6 pt-12 pb-10 text-white">
        <img src="/brand/icon-white-bg.png" alt="IQRA" className="w-20 h-20 rounded-2xl mb-4 shadow-lg" />
        <h1 className="text-2xl font-black">Create Account</h1>
        <p className="text-brand-100 text-sm mt-1">Join thousands of Balochistan students</p>
      </div>

      <div className="flex-1 px-6 pt-8 flex flex-col gap-4 overflow-y-auto">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl dark:bg-red-950/40">
            {error}
          </div>
        )}

        {[
          { key: 'fullName', label: 'Full Name', icon: User, placeholder: 'Ahmed Raza', type: 'text' },
          { key: 'email',    label: 'Email',     icon: Mail, placeholder: 'student@example.com', type: 'email' },
          { key: 'password', label: 'Password',  icon: Lock, placeholder: '••••••••', type: 'password' },
        ].map(({ key, label, icon: Icon, placeholder, type }) => (
          <div key={key}>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block dark:text-slate-300">{label}</label>
            <div className="relative">
              <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" size={16} />
              <input
                type={type}
                value={(form as any)[key]}
                onChange={e => update(key, e.target.value)}
                placeholder={placeholder}
                className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>
        ))}

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block dark:text-slate-300">District</label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" size={16} />
            <select
              value={form.district}
              onChange={e => update('district', e.target.value)}
              className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 bg-white appearance-none dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
            >
              {DISTRICTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handleSignup}
          disabled={loading}
          className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 disabled:opacity-60 active:scale-95 transition-all mt-2"
        >
          {loading ? 'Creating account...' : 'Create Account 🚀'}
        </button>

        <div className="text-center pb-4">
          <span className="text-sm text-gray-500 dark:text-slate-400">Already have an account? </span>
          <button onClick={() => navigate('/login')} className="text-sm font-semibold text-brand-600">Sign In</button>
        </div>
      </div>
    </div>
  )
}
