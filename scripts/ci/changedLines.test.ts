/** @jest-environment node */
import { parseChangedLines } from './changedLines.ts'

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -3 +3 @@ keep',
  '-old',
  '+new',
  '@@ -10,0 +11,3 @@',
  '+x',
  '+y',
  '+z',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -5,2 +4,0 @@',
  '-gone',
  '-gone',
].join('\n')

describe('parseChangedLines', () => {
  it('collects single-line and multi-line hunks per file', () => {
    const files = parseChangedLines(diff)
    expect([...files.get('src/a.ts')!]).toEqual([3, 11, 12, 13])
  })

  it('records a file with only deletions as having no changed lines', () => {
    expect(parseChangedLines(diff).get('src/b.ts')?.size).toBe(0)
  })

  it('returns an empty map for an empty diff', () => {
    expect(parseChangedLines('').size).toBe(0)
  })

  it('ignores hunks that appear before any file header', () => {
    expect(parseChangedLines('@@ -1 +1 @@').size).toBe(0)
  })

  it('keeps spaces in paths and drops the trailing tab git appends to them', () => {
    const spaced = 'diff --git a/src/with space.ts b/src/with space.ts\n--- a/src/with space.ts\t\n+++ b/src/with space.ts\t\n@@ -1 +1 @@\n+x'
    expect([...parseChangedLines(spaced).keys()]).toEqual(['src/with space.ts'])
  })

  it('does not attribute a file with an unparsed new-side header to the previous file', () => {
    const noHeader = 'diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\ndiff --git a/src/c.ts b/src/c.ts\n@@ -4 +4,2 @@'
    expect([...parseChangedLines(noHeader).get('src/a.ts')!]).toEqual([1])
  })

  it('does not mistake an added line that looks like a header for a new file', () => {
    const tricky = 'diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n+++ b/src/evil.ts\n+y'
    expect([...parseChangedLines(tricky).keys()]).toEqual(['src/a.ts'])
  })

  it('skips deleted files (+++ /dev/null)', () => {
    const deleted = 'diff --git a/src/a.ts b/src/a.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@'
    expect(parseChangedLines(deleted).size).toBe(0)
  })

  it('fails loudly on a header it cannot parse instead of skipping the file', () => {
    const quoted = 'diff --git "a/x" "b/x"\n+++ "b/caf\\303\\251.ts"\n@@ -1 +1 @@'
    expect(() => parseChangedLines(quoted)).toThrow('unsupported diff header')
  })
})
