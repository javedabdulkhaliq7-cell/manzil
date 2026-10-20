// seniorClass.ts
//
// Single switch for everything that is specific to first-year and
// second-year students (Class 11 and Class 12): red/yellow note highlighting,
// the topic-based Notes layout, the typed Quiz hub, per-class Mock Test
// structure, etc. Classes 9 and 10 (and any other class) never match, so
// their screens keep today's behaviour exactly.
//
// USAGE:
//   const senior = isSeniorClass(chapter?.subjects?.class_level)
//   {senior ? <NotesTabSenior .../> : <existing notes JSX/>}
//
// Accepts the DB spelling ("Class 11", "Class 12") plus a few likely
// alternates ("11", "1st Year", "Second Year", "XI") so a small difference
// in how a class label is stored cannot silently switch the features off.

const SENIOR_RE = /(?:^|\D)(?:11|12)(?:th)?(?:\D|$)|\b(?:1st|2nd|first|second)\s*year\b|\b(?:xi|xii)\b/i

export function isSeniorClass(classLevel: string | null | undefined): boolean {
  if (!classLevel) return false
  return SENIOR_RE.test(classLevel.trim())
}
