import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    // Native (Android/Capacitor): navigator.onLine is known to be
    // unreliable here — it can report "online" just because wifi is
    // connected, even with no real internet behind it. Capacitor's own
    // Network plugin reads the actual OS-level connectivity state instead.
    if (Capacitor.isNativePlatform()) {
      Network.getStatus().then(status => setIsOffline(!status.connected))

      const listenerPromise = Network.addListener('networkStatusChange', status => {
        setIsOffline(!status.connected)
      })

      return () => { listenerPromise.then(l => l.remove()) }
    }

    // Web: unchanged — the standard browser online/offline events.
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div className="fixed top-0 left-0 right-0 max-w-sm mx-auto bg-red-600 text-white text-xs font-semibold flex items-center justify-center gap-2 py-2 px-4 z-50">
      <WifiOff size={13} />
      No internet connection — some things may not load
    </div>
  )
}
