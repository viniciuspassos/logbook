import {
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
