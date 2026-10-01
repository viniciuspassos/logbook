import { extractEntry, mapActivityToShape } from './extractEntry.ts'

type Globals = typeof globalThis & { LanguageModel?: unknown }
const g = globalThis as Globals

function mockLanguageModel(promptImpl: () => Promise<string>) {
  const destroy = jest.fn()
  const prompt = jest.fn(promptImpl)
  const create = jest.fn().mockResolvedValue({ prompt, destroy })
  g.LanguageModel = { create, availability: jest.fn() }
  return { create, prompt, destroy }
}

afterEach(() => {
  delete g.LanguageModel
})

describe('mapActivityToShape', () => {
  it.each([
    ['Skydiving', 'circle'],
    ['Tandem jump', 'circle'],
    ['Rock climbing', 'triangle'],
    ['Mountaineering', 'triangle'],
    ['Hiking', 'diamond'],
    ['Multi-day trek', 'diamond'],
    ['Ski touring', 'diamond'],
    ['Kayaking', 'triangle'], // unknown -> default
  ] as const)('%s -> %s', (activity, shape) => {
    expect(mapActivityToShape(activity)).toBe(shape)
  })
})

describe('extractEntry', () => {
  it('throws when the LanguageModel API is unavailable', async () => {
    await expect(extractEntry('some note')).rejects.toThrow(/unavailable/)
  })

  it('parses a valid structured response and destroys the session', async () => {
    const { destroy } = mockLanguageModel(async () =>
      JSON.stringify({
        title: 'Pico da Bandeira',
        activityType: 'Climbing',
        shape: 'triangle',
        location: 'Brazil',
        weather: 'Windy',
      }),
    )

    const result = await extractEntry('Climbed Pico da Bandeira, really windy.')
    expect(result.title).toBe('Pico da Bandeira')
    expect(result.shape).toBe('triangle')
    expect(result.weather).toBe('Windy')
    expect(result.equipment).toBe('') // absent field defaults to empty
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('falls back to mapActivityToShape when shape is missing/invalid', async () => {
    mockLanguageModel(async () =>
      JSON.stringify({ title: 'Jump', activityType: 'Skydiving', shape: 'blob' }),
    )
    const result = await extractEntry('Did a tandem jump.')
    expect(result.shape).toBe('circle')
  })

  it('recovers JSON embedded in surrounding prose', async () => {
    mockLanguageModel(
      async () =>
        'Here you go:\n{"title":"Trek","activityType":"Hiking","shape":"diamond"}\nHope that helps!',
    )
    const result = await extractEntry('Went on a hike.')
    expect(result.title).toBe('Trek')
    expect(result.shape).toBe('diamond')
  })

  it('destroys the session and rethrows when the response is unparseable', async () => {
    const { destroy } = mockLanguageModel(async () => 'not json at all')
    await expect(extractEntry('note')).rejects.toThrow(/valid JSON/)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('tells the model that activityType is plain words, not an icon bucket', async () => {
    const { create } = mockLanguageModel(async () =>
      JSON.stringify({ title: 'Trek', activityType: 'Trekking', shape: 'diamond' }),
    )
    await extractEntry('Went on a trek.')
    const [{ initialPrompts }] = create.mock.calls[0]
    const systemPrompt: string = initialPrompts[0].content
    expect(systemPrompt).toMatch(/`activityType` is the activity in plain words/)
    expect(systemPrompt).toMatch(/never use a `shape` value as the `activityType`/)
  })

  it.each([
    ['triangle', 'triangle', 'Climbing', 'triangle'],
    ['Circle', 'circle', 'Skydiving', 'circle'],
    ['diamond', 'blob', 'Trekking', 'diamond'], // no valid shape: the echoed bucket decides it
    ['circle', 'triangle', 'Climbing', 'triangle'], // conflict: a valid shape wins, tag follows the icon
  ])(
    'replaces an echoed icon bucket (%s, shape %s) with %s and shape %s',
    async (activityType, shape, expectedActivity, expectedShape) => {
      mockLanguageModel(async () => JSON.stringify({ title: 'Summit', activityType, shape }))
      const result = await extractEntry('Got down from Kilimanjaro.')
      expect(result.activityType).toBe(expectedActivity)
      expect(result.shape).toBe(expectedShape)
    },
  )

  it('keeps a real activity type as-is', async () => {
    mockLanguageModel(async () =>
      JSON.stringify({ title: 'Summit', activityType: 'Mountaineering', shape: 'triangle' }),
    )
    const result = await extractEntry('Got down from Kilimanjaro.')
    expect(result.activityType).toBe('Mountaineering')
  })
})
