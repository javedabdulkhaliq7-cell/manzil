// Class 11/12 Notes tab — studied one topic at a time. A topic's short question check must be
// passed before the next topic opens. Used only when isSeniorClass(...) is true AND the chapter
// has a non-empty `topics` list (ChapterDetailScreen decides); Class 9/10 never load this file.
//
// Topic states (derived from the server's get_topic_progress):
//   PASSED  – tick, collapsed at the top; tap to re-read the notes (no questions)
//   CURRENT – unlocked, not passed: notes + checkpoint panel; the first one is open by default
//   LOCKED  – previous topic not passed: title with a lock, no content
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, CheckCircle, ChevronDown, ChevronUp, Bookmark, AlertCircle } from 'lucide-react'
import type { Chapter, ChapterTopic } from '../../lib/supabase'
import FractionText from '../FractionText'
import TopicBody from './TopicBody'
import CheckpointPanel from './CheckpointPanel'
import { isOffline } from '../../lib/connectivity'
import type { CheckpointNotice } from '../../lib/offlineDb'
import {
  createOfflineEngine,
  dismissNotice,
  getDownloadedBundle,
  loadNotices,
  loadOfflineProgress,
  noticeMessage,
  refreshPassedSnapshot,
  runCheckpointSync,
} from '../../lib/seniorOffline'
import {
  EMPTY_EXTRAS,
  getTopicProgress,
  loadChapterExtras,
  loadNotesPosition,
  saveNotesPosition,
  loadTopicBookmarks,
  setTopicBookmark,
  markNotesRead,
  makeServerEngine,
  type CheckpointEngine,
  type ChapterExtras,
  type SeniorNoteBlock,
  type TopicProgress,
} from '../../lib/seniorNotesApi'

type Status = 'passed' | 'current' | 'locked'
type Props = { chapter: Chapter; userId: string }

// Full class names are written out (not built from pieces) so Tailwind can see them.
const RED_STYLE =
  '[&_mark.hl-red]:!bg-red-100 [&_mark.hl-red]:!text-red-700 [&_mark.hl-red]:!font-bold [&_mark.hl-red]:!no-underline [&_mark.hl-red]:!border-b-0 [&_mark.hl-red]:!shadow-none [&_mark.hl-red]:!bg-none [&_mark.hl-red]:!rounded [&_mark.hl-red]:!px-1 ' +
  'dark:[&_mark.hl-red]:!bg-red-500/25 dark:[&_mark.hl-red]:!text-red-300'

const YELLOW_ON =
  '[&_mark.hl-yellow]:!bg-yellow-200 [&_mark.hl-yellow]:!text-yellow-900 [&_mark.hl-yellow]:!no-underline [&_mark.hl-yellow]:!border-b-0 [&_mark.hl-yellow]:!shadow-none [&_mark.hl-yellow]:!rounded [&_mark.hl-yellow]:!px-1 ' +
  'dark:[&_mark.hl-yellow]:!bg-yellow-400/25 dark:[&_mark.hl-yellow]:!text-yellow-200'

// Highlighted phrases (red = most important, yellow = helpful detail) are always shown, in colour.
const HIGHLIGHT_CLASSES = `${RED_STYLE} ${YELLOW_ON}`

const anchorId = (key: string) => `senior-topic-${key}`
const subUnitMatches = (subUnit: string | null, key: string) => !!subUnit && subUnit.startsWith(`${key} `)

export default function NotesTabSenior({ chapter, userId }: Props) {
  const navigate = useNavigate()
  const topics = useMemo<ChapterTopic[]>(
    () => [...(chapter.topics ?? [])].sort((a, b) => a.position - b.position),
    [chapter.topics],
  )

  const [progress, setProgress] = useState<TopicProgress | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [extras, setExtras] = useState<ChapterExtras>(EMPTY_EXTRAS)
  const [doneLocal, setDoneLocal] = useState<Set<string>>(new Set()) // topics with no questions, "Done reading"
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set())
  const [offlineMode, setOfflineMode] = useState(false) // working from the downloaded copy, no internet
  const [offlineNote, setOfflineNote] = useState<string | null>(null)
  const [notices, setNotices] = useState<CheckpointNotice[]>([])
  const [scrollTo, setScrollTo] = useState<string | null>(null)
  const markedRead = useRef(false)

  /* ----------------------------------------------------------------------- data */

  const firstCurrent = useCallback(
    (p: TopicProgress, done: Set<string>, preferred?: string | null): string | null => {
      const passed = new Set(p.passed)
      const unlocked = new Set(p.unlocked)
      const current = topics.filter((t) => unlocked.has(t.key) && !passed.has(t.key) && !done.has(t.key))
      return (current.find((t) => t.key === preferred) ?? current[0])?.key ?? null
    },
    [topics],
  )

  /** Progress from the server when online, from the downloaded copy when offline. */
  const fetchProgress = useCallback(
    async (offline: boolean): Promise<TopicProgress> => {
      if (offline) {
        const p = await loadOfflineProgress(userId, chapter.id)
        return { passed: p.passed, unlocked: p.unlocked }
      }
      const p = await getTopicProgress(chapter.id)
      refreshPassedSnapshot(chapter.id, p.passed).catch(() => {}) // keep the offline copy's passes fresh
      return p
    },
    [userId, chapter.id],
  )

  const engine = useMemo<CheckpointEngine>(
    () => (offlineMode ? createOfflineEngine(userId, chapter.id) : makeServerEngine(chapter.id)),
    [offlineMode, userId, chapter.id],
  )

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const bundle = await getDownloadedBundle(chapter.id).catch(() => undefined)
      let offline = await isOffline().catch(() => false)
      // Back online: first let the server re-check any passes earned offline, then read progress.
      if (!offline) await runCheckpointSync(userId)

      let p: TopicProgress | null = null
      let ex: ChapterExtras = EMPTY_EXTRAS
      let saved: string | null = null
      let marks = new Set<string>()

      if (!offline) {
        try {
          ;[p, ex, saved, marks] = await Promise.all([
            fetchProgress(false),
            loadChapterExtras(chapter.id),
            loadNotesPosition(userId, chapter.id).catch(() => null),
            loadTopicBookmarks(userId, chapter.id).catch(() => new Set<string>()),
          ])
        } catch (err) {
          if (!bundle) throw err
          offline = true // a weak connection: carry on from the downloaded copy
        }
      }
      if (offline) {
        if (!bundle) throw new Error('not_downloaded')
        p = await fetchProgress(true)
        ex = (bundle.seniorExtras as ChapterExtras | null | undefined) ?? EMPTY_EXTRAS
        setOfflineNote(
          bundle.checkpointPack
            ? null
            : "This chapter was downloaded without its questions. You can read the notes, but to answer the questions please connect to the internet.",
        )
      } else {
        setOfflineNote(null)
      }

      setOfflineMode(offline)
      setProgress(p)
      setExtras(ex)
      setBookmarks(marks)
      setNotices(await loadNotices(userId, chapter.id).catch(() => []))
      const open = firstCurrent(p as TopicProgress, new Set(), saved)
      if (open) {
        setExpanded(new Set([open]))
        setScrollTo(open)
      }
    } catch {
      setLoadError(true)
    }
  }, [chapter.id, userId, firstCurrent, fetchProgress])

  useEffect(() => {
    load()
  }, [load])

  // Scroll to a topic once it has rendered
  useEffect(() => {
    if (!scrollTo) return
    const t = window.setTimeout(() => {
      document.getElementById(anchorId(scrollTo))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setScrollTo(null)
    }, 60)
    return () => window.clearTimeout(t)
  }, [scrollTo])

  /* --------------------------------------------------------------------- states */

  const passedSet = useMemo(() => new Set(progress?.passed ?? []), [progress])
  const unlockedSet = useMemo(() => new Set(progress?.unlocked ?? []), [progress])
  const statusOf = useCallback(
    (key: string): Status => (passedSet.has(key) || doneLocal.has(key) ? 'passed' : unlockedSet.has(key) ? 'current' : 'locked'),
    [passedSet, unlockedSet, doneLocal],
  )

  const ordered = useMemo(() => {
    const by = (s: Status) => topics.filter((t) => statusOf(t.key) === s)
    return [...by('passed'), ...by('current'), ...by('locked')]
  }, [topics, statusOf])

  const passedCount = topics.filter((t) => statusOf(t.key) === 'passed').length
  const allDone = topics.length > 0 && passedCount === topics.length

  // Whole chapter finished -> set the existing notes_read flag once
  useEffect(() => {
    if (allDone && !markedRead.current) {
      markedRead.current = true
      markNotesRead(userId, chapter.id, chapter.subject_id).catch(() => {
        markedRead.current = false // try again next time
      })
    }
  }, [allDone, userId, chapter.id, chapter.subject_id])

  /* -------------------------------------------------------------------- actions */

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else {
        next.add(key)
        if (statusOf(key) === 'current') saveNotesPosition(userId, chapter.id, key).catch(() => {})
      }
      return next
    })
  }

  const toggleBookmark = (key: string) => {
    const on = !bookmarks.has(key)
    setBookmarks((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
    setTopicBookmark(userId, chapter.id, key, on).catch(() => {
      // roll back the tick if saving failed
      setBookmarks((prev) => {
        const next = new Set(prev)
        if (on) next.delete(key)
        else next.add(key)
        return next
      })
    })
  }

  const jumpTo = (key: string) => {
    if (statusOf(key) === 'locked') return
    setExpanded((prev) => new Set(prev).add(key))
    setScrollTo(key)
  }

  /** Pass screen "Continue": refresh from the server, collapse the finished topic, open the next. */
  const handleContinue = async (finishedKey: string) => {
    try {
      const p = await fetchProgress(offlineMode)
      setProgress(p)
      const next = firstCurrent(p, doneLocal)
      setExpanded((prev) => {
        const s = new Set(prev)
        s.delete(finishedKey)
        if (next) s.add(next)
        return s
      })
      if (next) {
        setScrollTo(next)
        saveNotesPosition(userId, chapter.id, next).catch(() => {})
      }
    } catch {
      setLoadError(true)
    }
  }

  /** Topic has no question pool: it counts as read; the server already unlocked the next one. */
  const handleNoQuestions = (key: string) => {
    const done = new Set(doneLocal).add(key)
    setDoneLocal(done)
    const next = progress ? firstCurrent(progress, done) : null
    setExpanded((prev) => {
      const s = new Set(prev)
      s.delete(key)
      if (next) s.add(next)
      return s
    })
    if (next) setScrollTo(next)
  }

  const handleReview = (key: string) => {
    setExpanded((prev) => new Set(prev).add(key))
    setScrollTo(key)
  }

  /* --------------------------------------------------------------------- render */

  const notes: SeniorNoteBlock[] = Array.isArray(chapter.detailed_notes) ? (chapter.detailed_notes as SeniorNoteBlock[]) : []
  const nextTitleFor = (key: string): string | null => {
    const i = topics.findIndex((t) => t.key === key)
    return i >= 0 && i + 1 < topics.length ? `${topics[i + 1].key} ${topics[i + 1].title}` : null
  }

  return (
    <>
      {/* Overview */}
      <div className="bg-gradient-to-br from-brand-50 to-brand-100/50 dark:from-slate-950 dark:to-brand-950/30 border border-brand-200 dark:border-brand-800 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">📗</span>
          <span className="text-xs font-bold text-brand-700 dark:text-brand-400">Summary</span>
        </div>
        <p className="text-xs text-brand-800 dark:text-brand-300 leading-relaxed">
          <FractionText text={chapter.summary ?? 'Summary not available yet.'} />
        </p>
      </div>

      {offlineMode && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          You're offline. {offlineNote ?? "Your answers are saved on this phone and will be checked again when you're back online."}
        </div>
      )}
      {notices.map((n) => (
        <div key={n.id} className="rounded-2xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30" role="alert">
          <p className="text-[11px] leading-relaxed text-red-800 dark:text-red-200">{noticeMessage(n)}</p>
          <button
            type="button"
            onClick={() => {
              if (n.id !== undefined) dismissNotice(n.id).catch(() => {})
              setNotices((prev) => prev.filter((x) => x.id !== n.id))
            }}
            className="mt-2 min-h-[36px] px-3 rounded-lg bg-white text-red-700 border border-red-200 text-[11px] font-bold dark:bg-slate-800 dark:text-red-300 dark:border-slate-700"
          >
            OK
          </button>
        </div>
      ))}

      {/* Progress strip */}
      <div className="bg-white rounded-2xl shadow-sm p-3 dark:bg-slate-800">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
            {allDone ? 'All topics complete' : `Topic ${Math.min(passedCount + 1, topics.length)} of ${topics.length}`}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-slate-500">{passedCount} / {topics.length} passed</span>
        </div>
        <div
          className="h-2 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={topics.length}
          aria-valuenow={passedCount}
          aria-label="Topics passed"
        >
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${topics.length ? (passedCount / topics.length) * 100 : 0}%` }} />
        </div>
      </div>

      {/* Jump bar */}
      {progress && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1" role="navigation" aria-label="Topics">
          {topics.map((t) => {
            const st = statusOf(t.key)
            return (
              <button
                key={t.key}
                type="button"
                disabled={st === 'locked'}
                onClick={() => jumpTo(t.key)}
                className={`flex-shrink-0 min-h-[36px] px-3 rounded-full text-[11px] font-semibold border flex items-center gap-1 ${
                  st === 'passed'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800'
                    : st === 'current'
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
                }`}
              >
                {st === 'passed' && <CheckCircle size={11} aria-hidden="true" />}
                {st === 'locked' && <Lock size={11} aria-hidden="true" />}
                {t.key}
              </button>
            )
          })}
        </div>
      )}

      {/* Loading / error */}
      {!progress && !loadError && (
        <div className="flex justify-center py-8">
          <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {loadError && (
        <div className="bg-white rounded-2xl shadow-sm p-4 text-center dark:bg-slate-800" role="alert">
          <AlertCircle size={22} className="mx-auto text-amber-500 mb-1" />
          <p className="text-xs text-gray-600 dark:text-slate-300 mb-3">
            Couldn't load your progress. Check your connection — the topic questions need internet.
          </p>
          <button type="button" onClick={load} className="min-h-[44px] px-6 bg-brand-600 text-white font-bold text-xs rounded-xl active:scale-95 transition-all">
            Try again
          </button>
        </div>
      )}

      {/* Topics: PASSED, then CURRENT, then LOCKED */}
      {progress &&
        ordered.map((topic) => {
          const st = statusOf(topic.key)
          const open = st !== 'locked' && expanded.has(topic.key)
          const su = (s: string | null) => subUnitMatches(s, topic.key)
          return (
            <section key={topic.key} id={anchorId(topic.key)} className="flex flex-col gap-3 scroll-mt-2">
              {/* Header */}
              <div
                className={`rounded-2xl p-3 flex items-center gap-2 ${
                  st === 'passed'
                    ? 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
                    : st === 'current'
                      ? 'bg-white shadow-sm border border-brand-200 dark:bg-slate-800 dark:border-brand-800'
                      : 'bg-gray-50 border border-gray-200 dark:bg-slate-800/60 dark:border-slate-700'
                }`}
              >
                {st === 'passed' && <CheckCircle size={18} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" aria-label="Passed" />}
                {st === 'locked' && <Lock size={16} className="text-gray-400 dark:text-slate-500 flex-shrink-0" aria-label="Locked" />}
                <button
                  type="button"
                  disabled={st === 'locked'}
                  onClick={() => toggleExpanded(topic.key)}
                  aria-expanded={open}
                  className="flex-1 min-w-0 min-h-[44px] text-left disabled:cursor-not-allowed"
                >
                  <div className={`text-[10px] font-bold ${st === 'locked' ? 'text-gray-400 dark:text-slate-500' : 'text-brand-600 dark:text-brand-400'}`}>
                    TOPIC {topic.key}
                  </div>
                  <div className={`text-sm font-bold leading-snug ${st === 'locked' ? 'text-gray-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'}`}>
                    <FractionText text={topic.title} />
                  </div>
                  {st === 'locked' && <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">Pass the earlier topic to unlock</div>}
                </button>
                {st !== 'locked' && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleBookmark(topic.key)}
                      aria-pressed={bookmarks.has(topic.key)}
                      aria-label={bookmarks.has(topic.key) ? 'Remove bookmark' : 'Bookmark this topic'}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <Bookmark size={16} className={bookmarks.has(topic.key) ? 'text-brand-600 fill-brand-500' : 'text-gray-400 dark:text-slate-500'} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(topic.key)}
                      aria-label={open ? 'Collapse topic' : 'Expand topic'}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      {open ? <ChevronUp size={18} className="text-gray-500" /> : <ChevronDown size={18} className="text-gray-500" />}
                    </button>
                  </>
                )}
              </div>

              {/* Body */}
              {open && (
                <>
                  <div className={HIGHLIGHT_CLASSES}>
                    <TopicBody
                      blocks={notes.filter((b) => b.topic_key === topic.key)}
                      definitions={extras.definitions.filter((d) => su(d.sub_unit))}
                      differentiations={extras.differentiations.filter((d) => su(d.sub_unit))}
                      misconceptions={extras.misconceptions.filter((m) => su(m.sub_unit))}
                      figures={extras.figures}
                    />
                  </div>

                  {st === 'current' && (
                    <CheckpointPanel
                      key={`${chapter.id}-${topic.key}`}
                      chapterId={chapter.id}
                      engine={engine}
                      topicKey={topic.key}
                      nextTitle={nextTitleFor(topic.key)}
                      onContinue={handleContinue}
                      onNoQuestions={handleNoQuestions}
                      onReviewNotes={handleReview}
                    />
                  )}
                </>
              )}
            </section>
          )
        })}

      {/* Wrap-up */}
      {allDone && (
        <div className="bg-white rounded-2xl shadow-sm p-4 dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={18} className="text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-black text-slate-900 dark:text-slate-100">Chapter notes complete</span>
          </div>
          {(chapter.key_points?.length ?? 0) > 0 && (
            <div className="mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase mb-1.5 dark:text-slate-500">Key points</div>
              <div className="flex flex-col gap-1.5">
                {chapter.key_points!.map((pt, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle size={12} className="text-brand-500 flex-shrink-0 mt-0.5" />
                    <span className="text-xs text-gray-700 leading-relaxed dark:text-slate-300"><FractionText text={pt} /></span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(chapter.mnemonics?.length ?? 0) > 0 && (
            <div className="mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase mb-1.5 dark:text-slate-500">Quick memory tricks</div>
              <div className="flex flex-col gap-1.5">
                {chapter.mnemonics!.map((mn, i) => (
                  <div key={i} className="text-xs text-gray-700 dark:text-slate-300">
                    <span className="font-bold text-slate-800 dark:text-slate-100"><FractionText text={mn.concept} /></span> →{' '}
                    <span className="italic"><FractionText text={mn.mnemonic} /></span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate(`/quiz/${chapter.id}`)}
            className="w-full min-h-[44px] bg-gradient-to-r from-brand-700 to-brand-500 text-white font-bold text-xs rounded-xl active:scale-95 transition-all"
          >
            Take the Chapter Quiz
          </button>
        </div>
      )}
    </>
  )
}
