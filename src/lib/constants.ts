export const SUBJECT_COLORS: Record<string, { bg: string; border: string; text: string; pill: string }> = {
  bio:  { bg: 'bg-brand-50 dark:bg-brand-950/40', border: 'border-brand-200 dark:border-brand-800', text: 'text-brand-800 dark:text-brand-300', pill: 'bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300 dark:text-brand-400' },
  chem: { bg: 'bg-blue-50 dark:bg-blue-950/40',       border: 'border-blue-200 dark:border-blue-800',       text: 'text-blue-800 dark:text-blue-300',       pill: 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300' },
  phy:  { bg: 'bg-orange-50 dark:bg-orange-950/40',   border: 'border-orange-200 dark:border-orange-800',   text: 'text-orange-800 dark:text-orange-300',   pill: 'bg-orange-100 dark:bg-orange-900/60 text-orange-700 dark:text-orange-300' },
  math: { bg: 'bg-violet-50 dark:bg-violet-950/40',   border: 'border-violet-200 dark:border-violet-800',   text: 'text-violet-800 dark:text-violet-300',   pill: 'bg-violet-100 dark:bg-violet-900/60 text-violet-700 dark:text-violet-300' },
  eng:  { bg: 'bg-red-50 dark:bg-red-950/40',         border: 'border-red-200 dark:border-red-800',         text: 'text-red-800 dark:text-red-300',         pill: 'bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300' },
  urdu: { bg: 'bg-teal-50 dark:bg-teal-950/40',       border: 'border-teal-200 dark:border-teal-800',       text: 'text-teal-800 dark:text-teal-300',       pill: 'bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300' },
}

export const RANKS = [
  { name: 'Beginner',  minXp: 0,      color: 'text-gray-500 dark:text-slate-400',    badge: '⚪' },
  { name: 'Student',   minXp: 500,    color: 'text-amber-700 dark:text-amber-400',   badge: '🟤' },
  { name: 'Scholar',   minXp: 2000,   color: 'text-gray-400 dark:text-slate-400',    badge: '⚪' },
  { name: 'Topper',    minXp: 5000,   color: 'text-yellow-500 dark:text-yellow-400', badge: '🟡' },
  { name: 'Champion',  minXp: 15000,  color: 'text-slate-400',                       badge: '🔵' },
  { name: 'Legend',    minXp: 50000,  color: 'text-cyan-400',                        badge: '💎' },
]

export function getRank(xp: number) {
  let rank = RANKS[0]
  for (const r of RANKS) {
    if (xp >= r.minXp) rank = r
  }
  return rank
}

export const FREE_MCQ_LIMIT = 20
export const FREE_AI_LIMIT = 10

// Offline mode (Section 6 of the offline spec): Free plan can have at most
// this many chapters downloaded per subject at once — the Download button
// becomes Remove once downloaded, and a further download past this count is
// blocked with a message to remove one first. Premium has no cap.
export const FREE_DOWNLOADS_PER_SUBJECT = 2

// ---------------------------------------------------------------------
// Leaderboard avatars — DiceBear "Personas" (https://www.dicebear.com/styles/personas,
// original artwork by "under-the-arc," CC BY 4.0; DiceBear's own code is
// MIT). Switched from Adventurer per an explicit visual reference: flat,
// minimalist circular people icons, muted palette, varied
// hair/hats/glasses/skin tones — a licensed Dreamstime stock illustration
// set (Copyright: Animak | Dreamstime.com). That exact artwork can't be
// reproduced or closely mimicked — it's someone else's licensed work —
// but Personas is DiceBear's own closest match to that same flat-minimal
// genre, and it's free to use (unlike the Dreamstime set, which requires
// a paid license). No real photo uploads — user base is mostly Class
// 9-12 (~14-18), so photos were ruled out for safety/moderation reasons
// (spec section 5). profiles.avatar_id (1-based) indexes into
// AVATAR_SEEDS below.
//
// Head-covering representation: checked DiceBear's docs directly rather
// than assume — their cross-style `headwear` tag filter (which would
// include a `headscarf` value) is documented as an *upcoming* release,
// not live yet; today the `tags` option only supports `animation`. Worth
// checking Personas' own option set in the Playground for a headwear-like
// hair variant if this is a hard requirement, and revisiting once
// DiceBear ships the tag category either way.
//
// Seeds are real Pakistani first names rather than "iqra-01" placeholders
// — purely as hash input for visual variety, not tied to any real
// person. Still worth a final eyeball pass in the Playground
// (https://www.dicebear.com/playground?style=personas) since I can't
// render the actual output in this environment.
// ---------------------------------------------------------------------
export const AVATAR_SEEDS = [
  'Zara', 'Bilal', 'Ayesha', 'Kamran', 'Hina',
  'Imran', 'Sara', 'Faisal', 'Nida', 'Yusuf',
  'Rabia', 'Ali', 'Mehwish', 'Hamza', 'Sana',
  'Tariq', 'Noor', 'Saad', 'Amna', 'Laiba',
]

export function avatarUrl(avatarId: number): string {
  const seed = AVATAR_SEEDS[avatarId - 1] ?? AVATAR_SEEDS[0]
  return `https://api.dicebear.com/10.x/personas/svg?seed=${encodeURIComponent(seed)}&backgroundType=solid`
}
