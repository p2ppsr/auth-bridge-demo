import { randomBytes } from 'crypto'
import jwt from 'jsonwebtoken'
import { getDb } from '../db/knex.js'
import type { SessionPayload, DbSession } from '../types.js'

/** Format a Date as 'YYYY-MM-DD HH:MM:SS' (MySQL-compatible UTC) */
function toDbDatetime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

export class SessionService {
  private jwtSecret: string
  private ttlSeconds: number

  constructor(jwtSecret: string, ttlSeconds: number = 3600) {
    this.jwtSecret = jwtSecret
    this.ttlSeconds = ttlSeconds
  }

  /** Create a new session and return a signed JWT */
  async create(userId: number, identityKey: string, authMethod: string, isManagedWallet: boolean): Promise<string> {
    const sessionId = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000)

    await getDb()('auth_bridge_sessions').insert({
      id: sessionId,
      user_id: userId,
      expires_at: toDbDatetime(expiresAt)
    })

    const payload: SessionPayload = {
      sub: String(userId),
      ik: identityKey,
      am: authMethod,
      managed: isManagedWallet
    }

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.ttlSeconds,
      jwtid: sessionId
    })
  }

  /** Verify a JWT and return the payload, or null if invalid/expired */
  async verify(token: string): Promise<(SessionPayload & { jti: string }) | null> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as SessionPayload & { jti: string }

      // Verify the session still exists in DB (not logged out)
      const session = await getDb()('auth_bridge_sessions')
        .where({ id: decoded.jti })
        .first() as DbSession | undefined

      if (!session) return null
      if (new Date(session.expires_at) < new Date()) {
        await this.destroy(decoded.jti)
        return null
      }

      return decoded
    } catch {
      return null
    }
  }

  /** Destroy a session (logout) */
  async destroy(sessionId: string): Promise<void> {
    await getDb()('auth_bridge_sessions').where({ id: sessionId }).del()
  }

  /** Destroy all sessions for a user */
  async destroyAllForUser(userId: number): Promise<void> {
    await getDb()('auth_bridge_sessions').where({ user_id: userId }).del()
  }

  /** Clean up expired sessions */
  async cleanup(): Promise<number> {
    return getDb()('auth_bridge_sessions')
      .where('expires_at', '<', toDbDatetime(new Date()))
      .del()
  }

  // -- Magic link helpers --

  /** Create a magic link token */
  async createMagicLink(email: string, ttlSeconds: number = 900): Promise<string> {
    const token = randomBytes(64).toString('hex')
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

    await getDb()('auth_bridge_magic_links').insert({
      token,
      email,
      verified: false,
      expires_at: toDbDatetime(expiresAt)
    })

    return token
  }

  /** Mark a magic link as verified */
  async verifyMagicLink(token: string): Promise<string | null> {
    const db = getDb()
    const link = await db('auth_bridge_magic_links')
      .where({ token })
      .first()

    if (!link) return null
    if (link.verified) return link.email
    if (new Date(link.expires_at) < new Date()) return null

    await db('auth_bridge_magic_links')
      .where({ token })
      .update({ verified: true })

    return link.email
  }

  /** Check if a magic link has been verified (for polling) */
  async checkMagicLink(token: string): Promise<{ verified: boolean; email?: string }> {
    const link = await getDb()('auth_bridge_magic_links')
      .where({ token })
      .first()

    if (!link) return { verified: false }
    if (new Date(link.expires_at) < new Date()) return { verified: false }
    return { verified: !!link.verified, email: link.verified ? link.email : undefined }
  }
}
