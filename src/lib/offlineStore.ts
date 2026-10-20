// Private on-device storage for downloaded papers (Phase 11).
//
// It uses IndexedDB, which lives inside the app's own private data (the Android WebView or
// the browser profile). Nothing is written to Downloads or the gallery, there is no share or
// export, and other apps cannot read it. Everything is keyed by the signed-in user's id.
import { supabase } from './supabase'

// A name of its own: the app already has a different offline database called 'iqra_offline' (version 30),
// and two databases cannot share a name.
const DB_NAME = 'iqra_pastpapers_offline'
// Shown in error messages, so we can tell which version of the app a phone is really running.
export const BUILD_TAG = 'pp11-diag3'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { const e = new Error('IndexedDB is not available in this browser or mode'); note(e); reject(e); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; note(req.error); reject(req.error) }
    req.onblocked = () => { note(new Error('The storage database is blocked by another open tab')) }
  })
  return dbPromise
}

// The reason the last save or open failed, so the screens can say what is really wrong.
let lastError = ''
function note(e: unknown): void {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  lastError = [name, msg].filter(Boolean).join(': ') || 'unknown error'
  console.error('[IQRA offline] storage error:', e)
}
export function lastStorageError(): string { return lastError }
export function isQuotaError(): boolean { return /quota/i.test(lastError) }

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { note(req.error); reject(req.error) }
    tx.onabort = () => { if (tx.error) note(tx.error) }
  }))
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try { return (await run('readonly', s => s.get(key))) as T | undefined } catch { return undefined }
}

export async function kvSet(key: string, value: unknown): Promise<boolean> {
  try { await run('readwrite', s => s.put(value, key)); return true } catch (e) { note(e); return false }
}

export async function kvDel(key: string): Promise<void> {
  try { await run('readwrite', s => s.delete(key)) } catch { /* nothing to delete */ }
}

export async function kvKeys(prefix: string): Promise<string[]> {
  try {
    const keys = await run('readonly', s => s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '\uffff')))
    return (keys as IDBValidKey[]).map(String)
  } catch { return [] }
}

export async function kvEntries<T>(prefix: string): Promise<{ key: string; value: T }[]> {
  const keys = await kvKeys(prefix)
  const out: { key: string; value: T }[] = []
  for (const key of keys) {
    const value = await kvGet<T>(key)
    if (value !== undefined) out.push({ key, value })
  }
  return out
}

// Can this browser/phone save anything at all? Tried before a download starts.
export async function storageAvailable(): Promise<{ ok: boolean; reason: string }> {
  const key = 'selftest'
  const wrote = await kvSet(key, { t: Date.now() })
  if (!wrote) return { ok: false, reason: lastError }
  const back = await kvGet<{ t: number }>(key)
  await kvDel(key)
  return back ? { ok: true, reason: '' } : { ok: false, reason: 'Saved data could not be read back' }
}

export function jsonBytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).length } catch { return 0 }
}

// ---- key names (everything starts with the user id, so accounts never mix) ----
export const keys = {
  prefix: (uid: string) => `u:${uid}:`,
  meta: (uid: string) => `u:${uid}:meta`,
  subjects: (uid: string, classLevel: string) => `u:${uid}:subjects:${classLevel}`,
  pack: (uid: string, subjectId: string) => `u:${uid}:pack:${subjectId}`,
  paper: (uid: string, kind: 'past' | 'generated', id: string) => `u:${uid}:paper:${kind}:${id}`,
  papers: (uid: string) => `u:${uid}:paper:`,
  usedLog: (uid: string, subjectId: string) => `u:${uid}:usedlog:${subjectId}`,
  lastUser: 'lastUser',
}

// The signed-in user's id. Works offline: the session is kept on the device.
export async function getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id ?? null
  } catch { return null }
}

// What is kept when an account is removed from the device: anything not yet uploaded.
// Finished attempts live in their own queue and are never removed here.
type Keepable = { pendingSync?: boolean; pending?: unknown[] }
export async function purgeUser(uid: string): Promise<void> {
  for (const key of await kvKeys(keys.prefix(uid))) {
    const v = await kvGet<Keepable>(key)
    const unsynced = !!v && (v.pendingSync === true || (Array.isArray(v.pending) && v.pending.length > 0))
    if (!unsynced) await kvDel(key)
  }
}
