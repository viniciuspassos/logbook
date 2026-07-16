import { Injectable } from '@nestjs/common'
import { SessionsRepository } from './sessions.repository'
import type { Session } from './session.entity'
import { generateToken, hashToken } from './token.util'

const DAY_MS = 24 * 60 * 60 * 1000

export interface SessionsServiceOptions {
  sessionTtlDays: number
}

export interface CreatedSession {
  sessionToken: string
  csrfToken: string
  expiresAt: Date
}

/**
 * Owns session lifecycle: create (login), validate + slide the expiry
 * forward on use (so a long field trip doesn't strand the client's offline
 * write queue behind an expired cookie — see the auth report for the full
 * rationale), and revoke (logout).
 *
 * Renewal is deliberately conditional, not unconditional-on-every-request:
 * the expiry is only pushed back out once less than half the configured TTL
 * remains, trading a small amount of "session outlives last real use" slack
 * for far fewer database writes under normal, frequent usage.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly options: SessionsServiceOptions,
  ) {}

  async create(): Promise<CreatedSession> {
    const sessionToken = generateToken()
    const csrfToken = generateToken()
    const expiresAt = this.newExpiry()

    await this.sessionsRepository.create({
      tokenHash: hashToken(sessionToken),
      csrfToken,
      expiresAt,
    })

    return { sessionToken, csrfToken, expiresAt }
  }

  async validate(sessionToken: string): Promise<Session | null> {
    const session = await this.sessionsRepository.findByTokenHash(hashToken(sessionToken))
    if (!session) {
      return null
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessionsRepository.removeById(session.id)
      return null
    }

    const ttlMs = this.options.sessionTtlDays * DAY_MS
    const remainingMs = session.expiresAt.getTime() - Date.now()
    if (remainingMs < ttlMs / 2) {
      const renewedExpiry = this.newExpiry()
      await this.sessionsRepository.updateExpiresAt(session.id, renewedExpiry)
      return { ...session, expiresAt: renewedExpiry }
    }

    return session
  }

  async revoke(sessionToken: string): Promise<void> {
    await this.sessionsRepository.removeByTokenHash(hashToken(sessionToken))
  }

  private newExpiry(): Date {
    return new Date(Date.now() + this.options.sessionTtlDays * DAY_MS)
  }
}
