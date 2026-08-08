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
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-emerald-50 to-white">
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-500 px-6 pt-12 pb-10 text-white">
        <img src="/brand/icon-white-bg.png" alt="IQRA" className="w-20 h-20 rounded-2xl mb-4 shadow-lg" />
        <h1 className="text-2xl font-black">Create Account</h1>
        <p className="text-emerald-100 text-sm mt-1">Join thousands of Balochistan students</p>
      </div>

      <div className="flex-1 px-6 pt-8 flex flex-col gap-4 overflow-y-auto">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
            {error}
          </div>
        )}

        {[
          { key: 'fullName', label: 'Full Name', icon: User, placeholder: 'Ahmed Raza', type: 'text' },
          { key: 'email',    label: 'Email',     icon: Mail, placeholder: 'student@example.com', type: 'email' },
          { key: 'password', label: 'Password',  icon: Lock, placeholder: '••••••••', type: 'password' },
        ].map(({ key, label, icon: Icon, placeholder, type }) => (
          <div key={key}>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">{label}</label>
            <div className="relative">
              <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type={type}
                value={(form as any)[key]}
                onChange={e => update(key, e.target.value)}
                placeholder={placeholder}
                className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>
        ))}

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block">District</label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <select
              value={form.district}
              onChange={e => update('district', e.target.value)}
              className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 bg-white appearance-none"
            >
              {DISTRICTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handleSignup}
          disabled={loading}
          className="w-full bg-gradient-to-r from-emerald-700 to-emerald-500 text-white font-bold py-4 rounded-2xl text-sm shadow-lg shadow-emerald-200 disabled:opacity-60 active:scale-95 transition-all mt-2"
        >
          {loading ? 'Creating account...' : 'Create Account 🚀'}
        </button>

        <div className="text-center pb-4">
          <span className="text-sm text-gray-500">Already have an account? </span>
          <button onClick={() => navigate('/login')} className="text-sm font-semibold text-emerald-600">Sign In</button>
        </div>
      </div>
    </div>
  )
}
