// lib/listCache.ts
//
// Step 2 (offline navigation) — populate and read the lightweight
// Subjects/Chapters list caches. Written every time the student browses
// these screens online; read from when offline. Keeps navigation itself
// (not just a downloaded chapter's content) usable with zero connection.

import { offlineDb } from './offlineDb'
import { Subject, Chapter } from './supabase'

export async function cacheSubjectsList(subjects: Subject[]): Promise<void> {
  const cachedAt = new Date().toISOString()
  await offlineDb.cached_subjects.bulkPut(subjects.map(s => ({ ...s, cachedAt })))
}

export async function getCachedSubjectsList(classLevel: string): Promise<Subject[]> {
  const rows = await offlineDb.cached_subjects.where('class_level').equals(classLevel).toArray()
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getCachedSubject(subjectId: string): Promise<Subject | undefined> {
  return offlineDb.cached_subjects.get(subjectId)
}

export async function cacheChaptersList(chapters: Chapter[]): Promise<void> {
  const cachedAt = new Date().toISOString()
  await offlineDb.cached_chapters.bulkPut(chapters.map(c => ({ ...c, cachedAt })))
}

export async function getCachedChaptersList(subjectId: string): Promise<Chapter[]> {
  const rows = await offlineDb.cached_chapters.where('subject_id').equals(subjectId).toArray()
  return rows.sort((a, b) => a.number - b.number)
}
