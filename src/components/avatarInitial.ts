import type { AuthProfile } from '../types/auth.ts'

/** The letter shown when there's no picture (or it can't load offline). */
export function avatarInitial(profile: AuthProfile): string {
  const source = profile.name?.trim() || profile.email
  return source.charAt(0).toUpperCase()
}
