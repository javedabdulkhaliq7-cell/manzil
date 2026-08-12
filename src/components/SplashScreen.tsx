export default function SplashScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="flex flex-col items-center gap-5">
        <img src="/brand/icon.png" alt="IQRA" className="w-20 h-20 animate-pulse" />
        <div className="w-7 h-7 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  )
}
