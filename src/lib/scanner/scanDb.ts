// IQRA Scanner — local database (plan section 14, on Dexie instead of SQLite).
// Separate Dexie database so it can never interfere with the app's existing one.
// Put this file at src/lib/scanner/scanDb.ts
import Dexie, { type Table } from 'dexie'

export type ScanQuality = 'small' | 'normal' | 'high'

export interface ScanRow {
  id: string
  userId: string
  name: string               // display name (may be Urdu); file system uses the id only
  classId: string            // e.g. profile.class_level
  subjectId: string | null
  subjectLabel: string       // cached so folder names work offline
  chapterId: string | null
  pageCount: number
  sizeBytes: number
  createdAt: number
  updatedAt: number
  folderPath: string         // relative to Directory.Data, e.g. scans/<user>/<scan>
  pdfPath: string
  thumbPath: string
  quality: ScanQuality
  mode?: 'text' | 'colour' // how the pages were cleaned up; missing on scans saved before this existed
  ocrStatus: 'pending' | 'done' | 'skipped' | 'none'
  localCopyUri: string | null
  lastViewedPage: number
}

export interface CustomSubject { id: string; userId: string; name: string; classId: string }
export interface OcrPage { id: string; scanId: string; userId: string; pageIndex: number; text: string; words: string[] }
export interface ChaptersCache { subjectId: string; chapters: { id: string; title: string }[]; updatedAt: number }
export interface SubjectsCache { classId: string; subjects: { id: string; label: string; emoji?: string }[]; updatedAt: number }

class ScanDb extends Dexie {
  scans!: Table<ScanRow, string>
  customSubjects!: Table<CustomSubject, string>
  subjectsCache!: Table<SubjectsCache, string>
  chaptersCache!: Table<ChaptersCache, string>
  ocrPages!: Table<OcrPage, string>
  constructor() {
    super('iqra-scans')
    this.version(1).stores({
      scans: 'id, userId, subjectId, classId, createdAt, [userId+createdAt]',
    })
    this.version(2).stores({
      scans: 'id, userId, subjectId, classId, createdAt, [userId+createdAt]',
      customSubjects: 'id, userId, classId',
      subjectsCache: 'classId',
    })
    this.version(3).stores({
      scans: 'id, userId, subjectId, classId, createdAt, [userId+createdAt]',
      customSubjects: 'id, userId, classId',
      subjectsCache: 'classId',
      chaptersCache: 'subjectId',
    })
    this.version(4).stores({
      scans: 'id, userId, subjectId, classId, createdAt, [userId+createdAt]',
      customSubjects: 'id, userId, classId',
      subjectsCache: 'classId',
      chaptersCache: 'subjectId',
      ocrPages: 'id, scanId, userId, *words',
    })
  }
}

export const scanDb = new ScanDb()
