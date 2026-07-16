type ClassValue = string | false | null | undefined

/**
 * Join truthy class-name fragments with single spaces. Replaces the hand-rolled
 * `` `${base}${cond ? ' is-active' : ''}` `` pattern scattered across the UI.
 */
export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}
