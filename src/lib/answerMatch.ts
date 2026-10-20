/**
 * IQRA — typed-answer matcher for Class 11/12 topic checkpoints.
 *
 * This is the PHONE copy of the matcher. It must give exactly the same result as the
 * database functions `_answer_matches`, `_answer_norm`, and `_answer_plural_of`
 * (Supabase). The shared test file `answerMatchVectors.json` is run
 * against BOTH by `npm run test:matcher`; if they ever disagree the check fails.
 *
 * Rules (Master Plan section 6.2). N(x) = normalise(x). s = N(typed), c = N(candidate),
 * where candidate is the canonical answer or any accepted answer:
 *   0. A blank typed answer is always wrong.
 *   1. N(s) = N(c).
 *   2. Equal after removing spaces ("cellwall" = "cell wall"), except that a space between
 *      two digits is kept ("1 0" is not "10").
 *   3. A trailing plural (s / es) is allowed on either side; the word must keep at
 *      least 3 letters once the ending is removed ("ribosomes" = "ribosome").
 *   4. NO spelling tolerance: a misspelled word is wrong, however small the slip.
 *      (Owner decision, 8 Oct 2026; replaces the one-letter-slip rule of the first plan.)
 *   5. If c contains a digit the answer must match exactly (rules 1 and 2 only).
 *
 * Normalisation: Unicode NFKC, lower case, hyphens/underscores/slashes/dashes become
 * spaces (but a minus sign in front of a number is kept: "-0.5" is not "0.5"), every other
 * character that is not a letter, digit or space is dropped (except a "." between two
 * digits, which is kept so 37.5 and 375 stay different), runs
 * of spaces collapse to one, and a leading "the " / "a " / "an " is removed.
 *
 * Do not change a rule here without changing the SQL functions and the vectors.
 */

/** Normalise an answer. Mirrors SQL `_answer_norm`. */
export function answerNorm(input: string | null | undefined): string {
  let s = (input ?? '').normalize('NFKC').toLowerCase();
  // Dashes, underscores and slashes become spaces ... except a minus sign, which is a dash
  // that is not preceded by a letter/digit and is directly followed by a digit ("-0.5").
  s = s.replace(
    /[_/\u2010-\u2012\u2014\u2015]|(?<=[\p{L}\p{N}])[-\u2212\u2013]|[-\u2212\u2013](?![0-9])/gu,
    ' ',
  );
  s = s.replace(/[\u2212\u2013]/g, '-'); // any minus sign still left is written as a plain "-"
  s = s.replace(/[^\p{L}\p{N}\s.-]/gu, '');
  s = s.replace(/(?<![0-9])\.|\.(?![0-9])/g, ''); // keep a decimal point between two digits only
  s = s.replace(/\s+/g, ' ').trim();
  return s.replace(/^(the|a|an) /, '');
}

/** Remove spaces, except a space that sits between two digits ("1 0" must not equal "10"). */
function squash(x: string): string {
  return x.replace(/(?<![0-9]) | (?![0-9])/g, '');
}

const len = (s: string): number => Array.from(s).length;

/** True when `long` is `short` + "s" / "es" and the last word of `short` has >= 3 letters. Mirrors `_answer_plural_of`. */
function pluralOf(long: string, short: string): boolean {
  const m = /([^ ]+)$/.exec(short);
  const lastWord = m ? m[1] : '';
  return len(lastWord) >= 3 && (long === short + 's' || long === short + 'es');
}

/**
 * Does the typed answer match the canonical answer (or any accepted answer)?
 * Mirrors SQL `_answer_matches(p_typed, p_answer, p_accepted)`.
 */
export function answerMatches(
  typed: string | null | undefined,
  answer: string,
  accepted?: ReadonlyArray<unknown> | null,
): boolean {
  const s = answerNorm(typed);
  if (s === '') return false; // rule 0
  const ss = squash(s);

  const candidates: string[] = [answer];
  if (Array.isArray(accepted)) {
    for (const x of accepted) {
      if (x === null || x === undefined) continue;
      candidates.push(typeof x === 'string' ? x : String(x));
    }
  }

  for (const cand of candidates) {
    const c = answerNorm(cand);
    if (c === '') continue;
    const cs = squash(c);

    if (s === c) return true; // rule 1
    if (ss === cs) return true; // rule 2
    if (/[0-9]/.test(c)) continue; // rule 5: numbers must be exact
    if (pluralOf(s, c) || pluralOf(c, s)) return true; // rule 3
  }
  return false;
}

/**
 * Letter/digit count of each word of the canonical answer, used for the blank-boxes hint.
 * Reveals length only. Mirrors the `blanks` list built by the server.
 */
export function answerBlanks(answer: string): number[] {
  return answerNorm(answer)
    .split(' ')
    .filter((w) => w !== '')
    .map(len);
}
