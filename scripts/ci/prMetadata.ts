// Pure rules for the PR-hygiene CI gate (see .github/workflows/ci-pr-hygiene.yml).
// Kept free of I/O so every rule is unit-testable; checkPrMetadata.ts does the GitHub calls.

// Same pattern as .githooks/commit-msg — keep the two in sync.
// A test asserts the two stay identical (the squash-merge subject comes from the PR title
// and bypasses the commit-msg hook, so both must enforce the same rule).
export const CONVENTIONAL_TITLE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9./_-]+\))?!?: .+/

const ISSUE_REFERENCE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\b:?[ \t]+#(\d+)\b/gi

const HTML_COMMENT = /<!--[\s\S]*?-->/g

const MIN_SUMMARY_LENGTH = 10

export function isConventionalTitle(title: string): boolean {
  return CONVENTIONAL_TITLE.test(title)
}

export function extractIssueNumbers(body: string): number[] {
  const numbers = new Set<number>()
  for (const match of body.replace(HTML_COMMENT, '').matchAll(ISSUE_REFERENCE)) {
    numbers.add(Number(match[1]))
  }
  return [...numbers]
}

/** True when the `## Summary` section has real text, not just template placeholders. */
export function hasFilledSummary(body: string): boolean {
  const section = /^##\s+Summary\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body)
  if (!section) return false
  const text = section[1]
    .replace(HTML_COMMENT, '')
    .replace(/^[ \t]*#+[ \t].*$/gm, '')
    .replace(/^[ \t]*[-*][ \t]*(\[[ xX]\])?/gm, '')
    .trim()
  return text.length >= MIN_SUMMARY_LENGTH
}

export interface PrMetadata {
  title: string
  body: string | null
}

export function validatePrMetadata({ title, body }: PrMetadata): string[] {
  const errors: string[] = []
  const text = body ?? ''
  if (!isConventionalTitle(title)) {
    errors.push(
      `Title "${title}" must follow Conventional Commits: <type>(<scope>)?: <description>.`,
    )
  }
  if (!hasFilledSummary(text)) {
    errors.push('The description needs a "## Summary" section with at least a sentence of real content.')
  }
  if (extractIssueNumbers(text).length === 0) {
    errors.push('The description must link an issue, e.g. "Closes #123" (Closes/Fixes/Resolves/Refs).')
  }
  return errors
}
