/** Consonants whose doubling survives a suffix strip ("rolling" -> "roll", "passing" -> "pass"). */
const KEEP_DOUBLED = new Set(['l', 's', 'z'])

/** Words that carry no meaning in a search ("climbing in Yosemite"); ignored on both sides. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'i', 'in', 'into', 'my', 'of', 'on', 'or',
  'our', 'the', 'to', 'we', 'with',
])

function undouble(word: string): string {
  const last = word.at(-1) ?? ''
  const isDoubledConsonant = word.length > 2 && last === word.at(-2) && !/[aeiouy]/.test(last)
  return isDoubledConsonant && !KEEP_DOUBLED.has(last) ? word.slice(0, -1) : word
}

/**
 * Crude English stemmer — just enough for the AI search's keywords to meet the
 * words entries actually use ("climbs"/"climbed" vs "Climbing", "treks" vs
 * "trekking"). Not a linguistic stemmer: both sides go through the same rules,
 * so an odd stem ("hik") still matches its own inflections. The plural goes
 * first so "landings" and "landing" end up together.
 */
export function stem(word: string): string {
  let w = word.toLowerCase()
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`
  else if (/(ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) w = undouble(w.slice(0, -3))
  else if (w.length > 4 && w.endsWith('ed')) w = undouble(w.slice(0, -2))
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

interface Term {
  raw: string
  stem: string
}

function terms(text: string): Term[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !STOPWORDS.has(word))
    .map((raw) => ({ raw, stem: stem(raw) }))
}

/** Same stem, or the needle starts the word (a half-typed "patag" finds "Patagonia"). */
function termMatches(word: Term, needle: Term): boolean {
  return word.stem === needle.stem || (needle.raw.length >= 3 && word.raw.startsWith(needle.raw))
}

/**
 * Whether `needle`'s words appear, in order, among `haystack`'s words — each
 * matching by stem or as the start of a word. Whole words only, so "Andes"
 * never matches inside "tandem". A needle of only stopwords is no constraint.
 */
export function containsTerm(haystack: string, needle: string): boolean {
  const wanted = terms(needle)
  if (wanted.length === 0) return true
  const words = terms(haystack)
  for (let start = 0; start + wanted.length <= words.length; start += 1) {
    if (wanted.every((term, i) => termMatches(words[start + i], term))) return true
  }
  return false
}
