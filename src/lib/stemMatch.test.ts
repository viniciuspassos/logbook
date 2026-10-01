import { containsTerm, stem } from './stemMatch.ts'

describe('stem', () => {
  it.each([
    ['climbs', 'climb'],
    ['climbing', 'climb'],
    ['climbed', 'climb'],
    ['Treks', 'trek'],
    ['trekking', 'trek'],
    ['hikes', 'hik'],
    ['hiking', 'hik'],
    ['skydive', 'skydiv'],
    ['skydiving', 'skydiv'],
    ['skies', 'sky'],
    ['passes', 'pass'],
    ['pass', 'pass'],
    ['rolling', 'roll'],
    ['outings', 'out'],
    ['outing', 'out'],
    ['landings', 'land'],
    ['landing', 'land'],
    ['windy', 'windy'],
    ['sun', 'sun'],
  ])('%s -> %s', (word, expected) => {
    expect(stem(word)).toBe(expected)
  })
})

describe('containsTerm', () => {
  it('matches different inflections of the same word', () => {
    expect(containsTerm('Climbing', 'climbs')).toBe(true)
    expect(containsTerm('Multi-day trekking', 'treks')).toBe(true)
    expect(containsTerm('perfect landing', 'landings')).toBe(true)
  })

  it('ignores case and punctuation, and matches multi-word needles in order', () => {
    expect(containsTerm('Interlaken, Switzerland', 'interlaken')).toBe(true)
    expect(containsTerm('Torres del Paine W Trek', 'del paine')).toBe(true)
    expect(containsTerm('Torres del Paine W Trek', 'paine del')).toBe(false)
  })

  it('matches the start of a word, so a half-typed query still finds it', () => {
    expect(containsTerm('Patagonia, Chile', 'patag')).toBe(true)
    expect(containsTerm('Clear, light wind', 'wind')).toBe(true)
    expect(containsTerm('Windy', 'wind')).toBe(true)
  })

  it('keeps accented letters and digits as part of words', () => {
    expect(containsTerm('Espírito Santo, Brazil', 'espírito')).toBe(true)
    expect(containsTerm('Jun 21', 'jun')).toBe(true)
  })

  it('never matches inside an unrelated word', () => {
    expect(containsTerm('Solo tandem jump', 'Andes')).toBe(false)
    expect(containsTerm('Light rain and fog', 'Andes')).toBe(false)
    expect(containsTerm('Three days on the wall', 'Wales')).toBe(false)
    expect(containsTerm('Chilly morning', 'Chile')).toBe(false)
    expect(containsTerm('uneven terrain', 'evening')).toBe(false)
    expect(containsTerm('spectacular views', 'speed')).toBe(false)
    expect(containsTerm('sprained ankle', 'spring')).toBe(false)
  })

  it('treats a needle of only stopwords (or nothing) as no constraint', () => {
    expect(containsTerm('anything', 'in the')).toBe(true)
    expect(containsTerm('anything', ' - ')).toBe(true)
  })
})
