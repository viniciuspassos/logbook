import { deriveExcerpt, rewriteStory } from './rewriteStory.ts'

type Globals = typeof globalThis & { Rewriter?: unknown }
const g = globalThis as Globals

function mockRewriter(rewriteImpl: (input: string, options?: unknown) => Promise<string>) {
  const destroy = jest.fn()
  const rewrite = jest.fn(rewriteImpl)
  const create = jest.fn().mockResolvedValue({ rewrite, destroy })
  g.Rewriter = { create, availability: jest.fn() }
  return { create, rewrite, destroy }
}

afterEach(() => {
  delete g.Rewriter
})

describe('deriveExcerpt', () => {
  it('returns an empty string for empty input', () => {
    expect(deriveExcerpt('   ')).toBe('')
  })

  it('takes the first sentence when short enough', () => {
    expect(deriveExcerpt('Clear skies today. The rest was fine.')).toBe(
      'Clear skies today.',
    )
  })

  it('truncates a long first sentence with an ellipsis', () => {
    const long = 'a'.repeat(200)
    const excerpt = deriveExcerpt(long)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(121)
  })

  it('handles a story with no sentence terminator', () => {
    expect(deriveExcerpt('just a fragment')).toBe('just a fragment')
  })
})

describe('rewriteStory', () => {
  it('throws when the Rewriter API is unavailable', async () => {
    await expect(rewriteStory('raw')).rejects.toThrow(/unavailable/)
  })

  it('returns the trimmed rewritten text and destroys the session', async () => {
    const { destroy } = mockRewriter(async () => '  A polished story.  ')
    expect(await rewriteStory('rough note')).toBe('A polished story.')
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('passes a variation context when variant > 0', async () => {
    const { rewrite } = mockRewriter(async () => 'variant output')
    await rewriteStory('rough note', { variant: 2 })
    const [, options] = rewrite.mock.calls[0]
    expect((options as { context?: string }).context).toMatch(/variation 2/)
  })

  it('omits the variation context on the first pass', async () => {
    const { rewrite } = mockRewriter(async () => 'first output')
    await rewriteStory('rough note')
    const [, options] = rewrite.mock.calls[0]
    expect((options as { context?: string }).context).toBeUndefined()
  })
})
