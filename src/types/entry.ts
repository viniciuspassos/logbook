export type AdventureShape = 'circle' | 'triangle' | 'diamond'

export interface Entry {
  id: number
  title: string
  shape: AdventureShape
  location: string
  date: string
  metric: string
  excerpt: string
  weather: string
  duration: string
  difficulty: string
  equipment: string
  participants: string
  raw: string
  story: string
  photoHint: string
  media: [string, string, string]
  /** Percent position (0-100) on the timeline's map view. */
  mapX: number
  mapY: number
}
