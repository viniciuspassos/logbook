export type AdventureShape = 'circle' | 'triangle' | 'diamond'

export interface Entry {
  id: number
  title: string
  shape: AdventureShape
  /**
   * Optional richer activity classification from the AI (e.g. "Skydiving",
   * "Climbing", "Hiking"). Additive to `shape`, which stays the 3-value icon
   * bucket; older seed entries may omit this.
   */
  activityType?: string
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
