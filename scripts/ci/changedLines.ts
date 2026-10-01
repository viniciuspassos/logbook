// Parses `git diff -U0` output into the new-side line numbers each file touched.
// Pure and I/O-free; diffCoverage.ts runs git and feeds the text in.
// Expects `--src-prefix=a/ --dst-prefix=b/ -c core.quotePath=false` (readDiff passes them), so a
// header we cannot parse (e.g. a C-quoted path) is an error, never a silently skipped file.

const FILE_START = /^diff --git /
const NEW_FILE_HEADER = /^\+\+\+ b\/([^\t]+)/
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** Added/modified line numbers (new side) per repo-relative file path. */
export function parseChangedLines(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>()
  let current: Set<number> | null = null
  let inHeader = false
  for (const line of diff.split('\n')) {
    if (FILE_START.test(line)) {
      inHeader = true
      current = null
    } else if (inHeader && line.startsWith('+++ ')) {
      current = startFile(files, line)
    } else if (line.startsWith('@@')) {
      inHeader = false
      const hunk = HUNK_HEADER.exec(line)
      if (hunk && current) addRange(current, Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2]))
    }
  }
  return files
}

function startFile(files: Map<string, Set<number>>, header: string): Set<number> | null {
  if (header === '+++ /dev/null') return null
  const match = NEW_FILE_HEADER.exec(header)
  if (!match) throw new Error(`unsupported diff header: ${header}`)
  const lines = new Set<number>()
  files.set(match[1], lines)
  return lines
}

// A pure deletion has count 0: nothing on the new side changed, so it adds no lines.
function addRange(lines: Set<number>, start: number, count: number): void {
  for (let i = 0; i < count; i++) lines.add(start + i)
}
