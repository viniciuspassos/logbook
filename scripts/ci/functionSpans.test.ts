/** @jest-environment node */
import { findFunctions, modifiedFunctions } from './functionSpans.ts'

const source = [
  'export function declared(a: number) {', // 1
  '  return a',
  '}', // 3
  'export const arrow = (a: number) => a * 2', // 4
  'const obj = {',
  '  method() {', // 6
  '    return 1',
  '  },', // 8
  '  prop: function () {', // 9
  '    return 2',
  '  },', // 11
  '}',
  'class K {',
  '  constructor() {', // 14
  '    this.x = 1',
  '  }', // 16
  '  get v() {', // 17
  '    return 1',
  '  }', // 19
  '  x: number',
  '  run() {', // 21
  '    const inner = () => 1', // 22
  '    return inner()',
  '  }', // 24
  '}',
  'declare function noBody(): void',
  'setTimeout(function () {}, 1)', // 27
].join('\n')

describe('findFunctions', () => {
  const spans = findFunctions(source, 'sample.ts')
  const byName = (name: string) => spans.find((s) => s.name === name)

  it('finds declarations, arrows, methods, function-valued properties, constructors and accessors', () => {
    expect(byName('declared')).toMatchObject({ name: 'declared', startLine: 1, endLine: 3, firstLine: 1 })
    expect(byName('arrow')).toMatchObject({ name: 'arrow', startLine: 4, endLine: 4, firstLine: 4 })
    expect(byName('method')).toMatchObject({ name: 'method', startLine: 6, endLine: 8, firstLine: 6 })
    expect(byName('prop')).toMatchObject({ name: 'prop', startLine: 9, endLine: 11, firstLine: 9 })
    expect(byName('constructor')).toMatchObject({ name: 'constructor', startLine: 14, endLine: 16, firstLine: 14 })
    expect(byName('v')).toMatchObject({ name: 'v', startLine: 17, endLine: 19, firstLine: 17 })
  })

  it('includes nested functions and names anonymous ones', () => {
    expect(byName('inner')).toMatchObject({ name: 'inner', startLine: 22, endLine: 22, firstLine: 22 })
    expect(byName('(anonymous)')?.startLine).toBe(27)
  })

  it('uses the name line for matching but counts decorator lines as part of the function', () => {
    const decorated = ['class C {', '  @Post()', '  @UseGuards(G)', '  upload(', '    a: number,', '  ) {', '    return a', '  }', '}'].join('\n')
    const [upload] = findFunctions(decorated, 'c.ts')
    expect(upload).toMatchObject({ name: 'upload', startLine: 4, endLine: 8, firstLine: 2 })
    expect(modifiedFunctions([upload], new Set([3]))).toEqual([upload])
  })

  it('reports the start column so same-line functions can be told apart', () => {
    const spans = findFunctions('const h = { a: () => 1, b: () => 2 }', 'h.ts')
    expect(spans.map((s) => [s.name, s.startColumn])).toEqual([['a', 15], ['b', 27]])
    expect(findFunctions('export function declared() {}', 'd.ts')[0].startColumn).toBe(16)
  })

  it('skips signatures without a body', () => {
    expect(byName('noBody')).toBeUndefined()
  })

  it('parses TSX when the file name ends in x', () => {
    const tsx = findFunctions('export const C = () => <div>{[1].map((n) => <b>{n}</b>)}</div>', 'c.tsx')
    expect(tsx.map((s) => s.name)).toEqual(['C', '(anonymous)'])
  })
})

describe('modifiedFunctions', () => {
  const spans = findFunctions(source, 'sample.ts')

  it('returns functions containing a changed line, including enclosing ones', () => {
    const names = modifiedFunctions(spans, new Set([22])).map((s) => s.name)
    expect(names).toEqual(['run', 'inner'])
  })

  it('returns nothing when changes fall outside every function', () => {
    expect(modifiedFunctions(spans, new Set([5, 20, 25]))).toEqual([])
  })
})
