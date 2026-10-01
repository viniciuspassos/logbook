/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONVENTIONAL_TITLE,
  extractIssueNumbers,
  hasFilledSummary,
  isConventionalTitle,
  validatePrMetadata,
} from './prMetadata.ts'

const repoFile = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8')

describe('CONVENTIONAL_TITLE', () => {
  it('stays identical to the pattern enforced by .githooks/commit-msg', () => {
    const hook = repoFile('.githooks', 'commit-msg')
    const pattern = /^pattern='(.*)'$/m.exec(hook)?.[1]
    expect(pattern).toBe(CONVENTIONAL_TITLE.source)
  })
})

describe('isConventionalTitle', () => {
  it.each(['feat: add x', 'fix(ui): y', 'chore!: z', 'ci(pr-hygiene): w'])('accepts %s', (title) => {
    expect(isConventionalTitle(title)).toBe(true)
  })

  it.each(['add x', 'feature: x', 'fix:', 'Fix: x'])('rejects %s', (title) => {
    expect(isConventionalTitle(title)).toBe(false)
  })
})

describe('extractIssueNumbers', () => {
  it('finds closing keywords case-insensitively and dedupes', () => {
    expect(extractIssueNumbers('Closes #12, fixes #13 and RESOLVES: #12. Refs #14')).toEqual([12, 13, 14])
  })

  it('ignores bare references and keywords without a number', () => {
    expect(extractIssueNumbers('see #5, closes nothing, prefixes #6')).toEqual([])
  })

  it('ignores references inside HTML comments', () => {
    expect(extractIssueNumbers('<!-- e.g. Closes #123 -->')).toEqual([])
  })

  it('does not cross newlines or match a number with trailing letters', () => {
    expect(extractIssueNumbers('Closes\n\n#9 and fixes #12abc')).toEqual([])
  })
})

describe('hasFilledSummary', () => {
  it('accepts a written summary', () => {
    expect(hasFilledSummary('## Summary\nAdds the PR hygiene gate.\n\n## Notes\nx')).toBe(true)
  })

  it('accepts a summary at the end of the body', () => {
    expect(hasFilledSummary('## Summary\n- Adds the PR hygiene gate')).toBe(true)
  })

  it('rejects a missing section', () => {
    expect(hasFilledSummary('Adds the PR hygiene gate to CI.')).toBe(false)
  })

  it('rejects the untouched template placeholder', () => {
    const template = '## Summary\n<!-- 1-3 bullets: what changed and why -->\n\n## Test plan\n- [ ] ok'
    expect(hasFilledSummary(template)).toBe(false)
  })

  it('rejects too-short content', () => {
    expect(hasFilledSummary('## Summary\n- fix\n')).toBe(false)
  })

  it('keeps hyphens inside real prose', () => {
    expect(hasFilledSummary('## Summary\n- a-b-c-d-e-f-g')).toBe(true)
  })

  it('does not count a sub-heading as content', () => {
    expect(hasFilledSummary('## Summary\n### Details\n\n## Notes\nlong enough text here')).toBe(false)
  })

  it('handles CRLF line endings from the GitHub web UI', () => {
    expect(hasFilledSummary('## Summary\r\nAdds the PR hygiene gate.\r\n\r\n## Notes\r\nx')).toBe(true)
  })
})

describe('validatePrMetadata', () => {
  const good = { title: 'ci: add gate', body: '## Summary\nAdds the gate.\n\nCloses #66' }

  it('returns no errors for a valid PR', () => {
    expect(validatePrMetadata(good)).toEqual([])
  })

  it('reports every violation at once for an empty PR', () => {
    expect(validatePrMetadata({ title: 'stuff', body: null })).toHaveLength(3)
  })

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('rejects the untouched PR template (%s)', (_name, eol) => {
    const template = repoFile('.github', 'pull_request_template.md').replace(/\r?\n/g, eol)
    const errors = validatePrMetadata({ title: 'ci: gate', body: template })
    expect(errors).toHaveLength(2)
    expect(errors.join(' ')).toMatch(/Summary/)
    expect(errors.join(' ')).toMatch(/link an issue/)
  })

  it('reports a missing issue link on its own', () => {
    const errors = validatePrMetadata({ ...good, body: '## Summary\nAdds the gate.' })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/link an issue/)
  })
})
