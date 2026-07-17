import {
  describeAiProcessingStatus,
  getAiCapabilities,
  getLanguageModelAvailability,
  getRewriterAvailability,
  isCapabilityUsable,
  isSpeechRecognitionSupported,
} from './availability.ts'

type Globals = typeof globalThis & {
  LanguageModel?: unknown
  Rewriter?: unknown
}

const g = globalThis as Globals

afterEach(() => {
  delete g.LanguageModel
  delete g.Rewriter
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
})

describe('getLanguageModelAvailability', () => {
  it('reports unavailable when the global is absent', async () => {
    expect(await getLanguageModelAvailability()).toBe('unavailable')
  })

  it('returns the availability reported by the API', async () => {
    g.LanguageModel = { availability: jest.fn().mockResolvedValue('available') }
    expect(await getLanguageModelAvailability()).toBe('available')
  })

  it('degrades to unavailable when availability() throws', async () => {
    g.LanguageModel = { availability: jest.fn().mockRejectedValue(new Error('boom')) }
    expect(await getLanguageModelAvailability()).toBe('unavailable')
  })
})

describe('getRewriterAvailability', () => {
  it('reports unavailable when the global is absent', async () => {
    expect(await getRewriterAvailability()).toBe('unavailable')
  })

  it('returns the availability reported by the API', async () => {
    g.Rewriter = { availability: jest.fn().mockResolvedValue('downloadable') }
    expect(await getRewriterAvailability()).toBe('downloadable')
  })
})

describe('isSpeechRecognitionSupported', () => {
  it('is false when neither global exists', () => {
    expect(isSpeechRecognitionSupported()).toBe(false)
  })

  it('is true when the webkit-prefixed global exists', () => {
    ;(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition =
      class {}
    expect(isSpeechRecognitionSupported()).toBe(true)
  })
})

describe('getAiCapabilities', () => {
  it('aggregates all three capabilities', async () => {
    g.LanguageModel = { availability: jest.fn().mockResolvedValue('available') }
    g.Rewriter = { availability: jest.fn().mockResolvedValue('downloadable') }
    ;(window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = class {}

    expect(await getAiCapabilities()).toEqual({
      speech: true,
      prompt: 'available',
      rewriter: 'downloadable',
    })
  })

  it('defaults everything off in a bare environment', async () => {
    expect(await getAiCapabilities()).toEqual({
      speech: false,
      prompt: 'unavailable',
      rewriter: 'unavailable',
    })
  })
})

describe('isCapabilityUsable', () => {
  it.each([
    ['available', true],
    ['downloadable', true],
    ['downloading', true],
    ['unavailable', false],
  ] as const)('%s -> %s', (capability, expected) => {
    expect(isCapabilityUsable(capability)).toBe(expected)
  })
})

describe('describeAiProcessingStatus', () => {
  it('is enabled only once both the prompt and rewriter models are ready', () => {
    expect(describeAiProcessingStatus({ prompt: 'available', rewriter: 'available' })).toBe(
      'enabled',
    )
  })

  it('is unavailable if either capability is unavailable', () => {
    expect(describeAiProcessingStatus({ prompt: 'unavailable', rewriter: 'available' })).toBe(
      'unavailable',
    )
    expect(describeAiProcessingStatus({ prompt: 'available', rewriter: 'unavailable' })).toBe(
      'unavailable',
    )
  })

  it('is downloading when a usable capability still needs its model fetched', () => {
    expect(describeAiProcessingStatus({ prompt: 'downloadable', rewriter: 'available' })).toBe(
      'downloading',
    )
    expect(describeAiProcessingStatus({ prompt: 'available', rewriter: 'downloading' })).toBe(
      'downloading',
    )
  })

  it('prefers unavailable over downloading when both are present', () => {
    expect(describeAiProcessingStatus({ prompt: 'unavailable', rewriter: 'downloadable' })).toBe(
      'unavailable',
    )
  })
})
