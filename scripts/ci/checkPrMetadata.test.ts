/** @jest-environment node */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectErrors,
  escapeAnnotation,
  issueExists,
  main,
  readPrFromEvent,
  type FetchLike,
} from './checkPrMetadata.ts'

const reply = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const lookup = (fetchFn: FetchLike) => ({ repo: 'o/r', token: 't', fetchFn })

function writeEvent(payload: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'pr-event-')), 'event.json')
  writeFileSync(path, JSON.stringify(payload))
  return path
}

describe('issueExists', () => {
  it('is true for a real issue and sends the token', async () => {
    const fetchFn = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>().mockResolvedValue(reply(200, {}))
    await expect(issueExists(5, lookup(fetchFn))).resolves.toBe(true)
    expect(fetchFn).toHaveBeenCalledWith('https://api.github.com/repos/o/r/issues/5', {
      headers: expect.objectContaining({ Authorization: 'Bearer t' }),
    })
  })

  it.each([404, 410])('is false for a %i', async (status) => {
    await expect(issueExists(5, lookup(async () => reply(status)))).resolves.toBe(false)
  })

  it('is false when the number is a pull request', async () => {
    await expect(issueExists(5, lookup(async () => reply(200, { pull_request: {} })))).resolves.toBe(false)
  })

  it('treats a null pull_request field as a real issue', async () => {
    await expect(issueExists(5, lookup(async () => reply(200, { pull_request: null })))).resolves.toBe(true)
  })

  it('is false for a malformed (non-object) body', async () => {
    await expect(issueExists(5, lookup(async () => reply(200, null)))).resolves.toBe(false)
  })

  it('throws on other API failures instead of passing silently', async () => {
    await expect(issueExists(5, lookup(async () => reply(500)))).rejects.toThrow('500')
  })
})

describe('collectErrors', () => {
  const pr = { title: 'ci: gate', body: '## Summary\nAdds the gate.\nCloses #1, refs #2' }

  it('passes when every linked issue exists', async () => {
    await expect(collectErrors(pr, lookup(async () => reply(200)))).resolves.toEqual([])
  })

  it('flags linked numbers that are not issues', async () => {
    const fetchFn: FetchLike = async (url) => (url.endsWith('/2') ? reply(404) : reply(200))
    await expect(collectErrors(pr, lookup(fetchFn))).resolves.toEqual(['#2 is not an existing issue in o/r.'])
  })

  it('includes metadata errors without calling the API for a null body', async () => {
    const fetchFn = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
    const errors = await collectErrors({ title: 'x', body: null }, lookup(fetchFn))
    expect(errors).toHaveLength(3)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('readPrFromEvent', () => {
  it('reads title and body from the event payload', () => {
    const path = writeEvent({ pull_request: { title: 'ci: a', body: 'b' } })
    expect(readPrFromEvent(path)).toEqual({ title: 'ci: a', body: 'b' })
  })

  it('defaults missing or non-string fields', () => {
    expect(readPrFromEvent(writeEvent({ pull_request: { title: 5, body: null } }))).toEqual({
      title: '',
      body: null,
    })
  })

  it.each([{}, null, { pull_request: 'x' }])('rejects non-PR payload %j', (payload) => {
    expect(() => readPrFromEvent(writeEvent(payload))).toThrow('pull_request')
  })
})

describe('escapeAnnotation', () => {
  it('escapes %, CR and LF per the workflow-command spec', () => {
    expect(escapeAnnotation('50%\r\nnext')).toBe('50%25%0D%0Anext')
  })
})

describe('main', () => {
  let errorSpy: jest.SpyInstance
  const ok: FetchLike = async () => reply(200)

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  const envFor = (payload: unknown) => ({
    GITHUB_EVENT_PATH: writeEvent(payload),
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_TOKEN: 't',
  })

  it('fails when the environment is incomplete', async () => {
    await expect(main({}, ok)).resolves.toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('::error::'))
  })

  it('returns 0 for a valid PR', async () => {
    const env = envFor({ pull_request: { title: 'ci: a', body: '## Summary\nAdds a gate.\nCloses #1' } })
    await expect(main(env, ok)).resolves.toBe(0)
  })

  it('returns 1 and annotates errors for an invalid PR', async () => {
    const env = envFor({ pull_request: { title: 'nope', body: null } })
    await expect(main(env, ok)).resolves.toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('::error::'))
  })

  it('fails closed with a readable annotation when the API errors', async () => {
    const env = envFor({ pull_request: { title: 'ci: a', body: '## Summary\nAdds a gate.\nCloses #1' } })
    await expect(main(env, async () => reply(403))).resolves.toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('could not run'))
  })
})
