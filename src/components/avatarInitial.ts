import type { AuthProfile } from '../types/auth.ts'

/** The letter shown when there's no picture (or it can't load offline). */
export function avatarInitial(profile: AuthProfile): string {
  const source = profile.name?.trim() || profile.email
  // Array.from walks code points, so an emoji or other astral character isn't split in half.
  return (Array.from(source)[0] ?? '').toUpperCase()
}
