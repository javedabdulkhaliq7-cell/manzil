// IQRA Scanner — subject folders (plan section 5).
// Put at src/lib/scanner/subjects.ts
import { supabase } from '../supabase'
import { scanDb } from './scanDb'

export interface ScanSubject { id: string; label: string; emoji?: string; custom: boolean }

/**
 * Subjects for a class: Iqra's own list (cached on the phone so folder names
 * work offline) + the student's own subjects. "Other" is added by the screen.
 * Assumes a `subjects` table with `class_level` and a `name` (or `title`) column.
 */
export async function loadSubjects(userId: string, classId: string): Promise<ScanSubject[]> {
  // refresh the cache when online; silently keep the old one when not
  try {
    const { data, error } = await supabase.from('subjects').select('*').eq('class_level', classId)
    if (!error && data && data.length > 0) {
      await scanDb.subjectsCache.put({
        classId,
        subjects: data.map((r: any) => ({ id: String(r.id), label: String(r.name ?? r.title ?? ''), emoji: r.emoji ?? undefined })),
        updatedAt: Date.now(),
      })
    }
  } catch { /* offline */ }

  const cached = await scanDb.subjectsCache.get(classId)
  const custom = await scanDb.customSubjects.where('userId').equals(userId).filter((c) => c.classId === classId).toArray()
  return [
    ...(cached?.subjects ?? []).map((s) => ({ ...s, custom: false })),
    ...custom.map((c) => ({ id: c.id, label: c.name, custom: true })),
  ]
}

export async function addCustomSubject(userId: string, classId: string, name: string) {
  const clean = name.trim()
  if (!clean) return
  await scanDb.customSubjects.add({ id: crypto.randomUUID(), userId, classId, name: clean })
}

/**
 * Chapters of an Iqra subject, cached so the picker works offline.
 * Assumes a `chapters` table with `subject_id` and `title` columns.
 */
export async function loadChapters(subjectId: string): Promise<{ id: string; title: string }[]> {
  try {
    const { data, error } = await supabase.from('chapters').select('id, title').eq('subject_id', subjectId)
    if (!error && data && data.length > 0) {
      await scanDb.chaptersCache.put({
        subjectId,
        chapters: data.map((r: any) => ({ id: String(r.id), title: String(r.title ?? '') })),
        updatedAt: Date.now(),
      })
    }
  } catch { /* offline */ }
  return (await scanDb.chaptersCache.get(subjectId))?.chapters ?? []
}

export async function renameCustomSubject(subjectId: string, name: string) {
  const clean = name.trim()
  if (!clean) return
  await scanDb.customSubjects.update(subjectId, { name: clean })
  await scanDb.scans.where('subjectId').equals(subjectId).modify({ subjectLabel: clean, updatedAt: Date.now() })
}

/** Deleting a subject never deletes scans: they move to Other. */
export async function deleteCustomSubject(subjectId: string) {
  await scanDb.scans.where('subjectId').equals(subjectId).modify({ subjectId: null, subjectLabel: 'Other', updatedAt: Date.now() })
  await scanDb.customSubjects.delete(subjectId)
}
