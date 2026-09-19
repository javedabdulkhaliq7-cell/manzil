import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { signInWithGoogle } from '../lib/googleAuth'
import { sendEmailOtp, verifyEmailOtp } from '../lib/emailOtp'

function GoogleIcon() {
  // Google's neutral/white mark — the correct version for a filled,
  // colored button per Google's own brand guidelines (the four-color "G"
  // is only for white/light buttons, which is why it looked off here).
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="24" fill="rgba(255,255,255,0.15)" />
      <text x="24" y="32" textAnchor="middle" fontSize="26" fontWeight="700" fill="white" fontFamily="Arial, sans-serif">G</text>
    </svg>
  )
}

const PENDING_CLASS_KEY = 'iqra_pending_class'

// Name and district are deliberately NOT collected here — that happens
// later, once the student has actually used the app a bit, not as a
// gate on signup.
export default function SignupScreen() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')

  async function handleGoogle() {
    setGoogleLoading(true); setError('')
    try {
      // Tells /auth/callback this came from Signup, not Login — so a
      // first-time Google sign-up sees the Welcome Moment + WhatsApp
      // prompt, while a returning Google sign-in (via /login) doesn't.
      localStorage.setItem('iqra_new_signup', 'true')
      await signInWithGoogle()
    } catch (err: any) {
      setError(err.message || 'Could not start Google sign-in')
      setGoogleLoading(false)
    }
  }

  async function handleSendCode() {
    if (!email) { setError('Enter your email first'); return }
    setSending(true); setError('')
    try {
      await sendEmailOtp(email)
      setStep('code')
    } catch (err: any) {
      setError(err.message || 'Could not send the code')
    } finally {
      setSending(false)
    }
  }

  async function handleVerify() {
    if (code.length < 6) { setError('Enter the code from your email'); return }
    setVerifying(true); setError('')
    try {
      const { user } = await verifyEmailOtp(email, code)
      if (user) {
        const pendingClass = localStorage.getItem(PENDING_CLASS_KEY)
        if (pendingClass) {
          await supabase.from('profiles').update({ class_level: pendingClass }).eq('id', user.id)
          localStorage.removeItem(PENDING_CLASS_KEY)
        }
      }
      navigate('/welcome-moment')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-brand-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="bg-gradient-to-br from-brand-700 to-brand-500 px-6 pt-12 pb-10 text-white">
        <img src="/brand/icon-white-bg.png" alt="IQRA" className="w-20 h-20 rounded-2xl mb-4 shadow-lg" />
        <h1 className="text-2xl font-bold">Create Account</h1>
        <p className="text-brand-100 text-sm mt-1">Join thousands of Balochistan students</p>
      </div>

      <div className="flex-1 px-6 pt-8 flex flex-col gap-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl dark:bg-red-950/40">
            {error}
          </div>
        )}

        {step === 'email' && (
          <div className="flex flex-col gap-4 animate-in fade-in duration-200">
            {/* Google is the recommended path — filled, brand-colored,
                and the only button with a shadow on this screen, so the
                eye lands here first. Email is available but visually quiet. */}
            <button
              onClick={handleGoogle}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-2.5 bg-gradient-to-r from-brand-700 to-brand-500 text-white font-semibold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 disabled:opacity-60 active:scale-95 transition-all"
            >
              <GoogleIcon />
              {googleLoading ? 'Connecting\u2026' : 'Continue with Google'}
            </button>

            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
              <span className="text-xs text-gray-400 dark:text-slate-500">or use your email</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block dark:text-slate-300">Email</label>
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
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">We'll only use this to sign you in — no spam.</p>
            </div>

            <button
              onClick={handleSendCode}
              disabled={sending}
              className="w-full border-2 border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold py-3.5 rounded-2xl text-sm disabled:opacity-60 active:scale-95 transition-all"
            >
              {sending ? 'Sending\u2026' : 'Continue'}
            </button>

            <div className="text-center pb-4">
              <span className="text-sm text-gray-500 dark:text-slate-400">Already have an account? </span>
              <button onClick={() => navigate('/login')} className="text-sm font-semibold text-brand-600">Sign In</button>
            </div>

            <p className="text-center text-[11px] text-gray-400 dark:text-slate-500 -mt-2 pb-2">
              By continuing, you agree to our{' '}
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</a>
            </p>
          </div>
        )}

        {step === 'code' && (
          <div className="flex flex-col gap-4 animate-in fade-in duration-200">
            <button
              onClick={() => { setStep('email'); setCode(''); setError('') }}
              className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 -ml-1"
            >
              <ArrowLeft size={16} /> Change email
            </button>

            <p className="text-sm text-gray-500 dark:text-slate-400">
              We sent a code to <span className="font-semibold text-slate-900 dark:text-slate-100">{email}</span>
            </p>

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block dark:text-slate-300">Code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={10}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-center text-lg tracking-[0.4em] font-semibold text-slate-900 bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <button
              onClick={handleVerify}
              disabled={verifying}
              className="w-full bg-gradient-to-r from-brand-700 to-brand-500 text-white font-semibold py-4 rounded-2xl text-sm shadow-lg shadow-brand-200 disabled:opacity-60 active:scale-95 transition-all mt-2"
            >
              {verifying ? 'Verifying\u2026' : 'Verify & Continue'}
            </button>

            <button
              onClick={handleSendCode}
              disabled={sending}
              className="text-sm font-semibold text-brand-600 text-center disabled:opacity-60"
            >
              {sending ? 'Resending\u2026' : 'Resend code'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
