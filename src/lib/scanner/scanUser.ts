// IQRA Scanner — remembers the last logged-in user so My Scans can open offline
// (plan section 15A). Put at src/lib/scanner/scanUser.ts
const KEY = 'iqra_scan_last_user'

export function rememberScanUser(id: string) {
  try { localStorage.setItem(KEY, id) } catch { /* ignore */ }
}
export function lastScanUser(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}
