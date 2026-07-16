// Minimal ambient declarations for the Web Speech API's SpeechRecognition
// surface. Neither `SpeechRecognition` nor `webkitSpeechRecognition` ships in
// this TS version's `lib.dom.d.ts`, and no `@types/dom-speech-recognition`
// dependency is present, so we declare just the members Logbook uses.

interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  readonly [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  readonly [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

type SpeechRecognitionErrorCode =
  | 'no-speech'
  | 'aborted'
  | 'audio-capture'
  | 'network'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'bad-grammar'
  | 'language-not-supported'

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: SpeechRecognitionErrorCode
  readonly message: string
}

interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: ((event: Event) => void) | null
  onstart: ((event: Event) => void) | null
}

interface SpeechRecognitionStatic {
  new (): SpeechRecognition
}

interface Window {
  SpeechRecognition?: SpeechRecognitionStatic
  webkitSpeechRecognition?: SpeechRecognitionStatic
}
