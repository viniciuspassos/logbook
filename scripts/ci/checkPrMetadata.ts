// Invoked through scripts/ci/runCheckPrMetadata.ts (no logic there, so this stays testable).
import { readFileSync } from 'node:fs'
import { extractIssueNumbers, validatePrMetadata, type PrMetadata } from './prMetadata.ts'

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

interface IssueLookup {
  repo: string
  token: string
  fetchFn: FetchLike
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** True only for a real issue — GitHub's issues endpoint also answers for PR numbers. */
export async function issueExists(number: number, { repo, token, fetchFn }: IssueLookup): Promise<boolean> {
  const response = await fetchFn(`https://api.github.com/repos/${repo}/issues/${number}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  // 410 = deleted issue.
  if (response.status === 404 || response.status === 410) return false
  if (!response.ok) throw new Error(`GitHub API returned ${response.status} for issue #${number}`)
  const issue = await response.json()
  return isRecord(issue) && (issue.pull_request === undefined || issue.pull_request === null)
}

export async function collectErrors(pr: PrMetadata, lookup: IssueLookup): Promise<string[]> {
  const errors = validatePrMetadata(pr)
  const numbers = extractIssueNumbers(pr.body ?? '')
  const exists = await Promise.all(numbers.map((n) => issueExists(n, lookup)))
  numbers.forEach((n, i) => {
    if (!exists[i]) errors.push(`#${n} is not an existing issue in ${lookup.repo}.`)
  })
  return errors
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function readPrFromEvent(eventPath: string): PrMetadata {
  const event: unknown = JSON.parse(readFileSync(eventPath, 'utf8'))
  const pr = isRecord(event) ? event.pull_request : undefined
  if (!isRecord(pr)) throw new Error('Not a pull_request event payload.')
  return { title: asString(pr.title) ?? '', body: asString(pr.body) }
}

/** Workflow-command data must escape %, CR and LF (the PR title is user-controlled). */
export function escapeAnnotation(message: string): string {
  return message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

export async function main(env: NodeJS.ProcessEnv, fetchFn: FetchLike = fetch): Promise<number> {
  const { GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_TOKEN } = env
  if (!GITHUB_EVENT_PATH || !GITHUB_REPOSITORY || !GITHUB_TOKEN) {
    console.error('::error::GITHUB_EVENT_PATH, GITHUB_REPOSITORY and GITHUB_TOKEN are required.')
    return 1
  }
  try {
    const errors = await collectErrors(readPrFromEvent(GITHUB_EVENT_PATH), {
      repo: GITHUB_REPOSITORY,
      token: GITHUB_TOKEN,
      fetchFn,
    })
    errors.forEach((error) => console.error(`::error::${escapeAnnotation(error)}`))
    return errors.length === 0 ? 0 : 1
  } catch (error) {
    // Fail closed, but with a readable annotation instead of a stack trace.
    console.error(`::error::${escapeAnnotation(`PR hygiene check could not run: ${String(error)}`)}`)
    return 1
  }
}
