import type { Response, NextFunction } from 'express'
import type { AuthBridgeRequest } from '../types.js'
import type { UserService } from '../services/UserService.js'
import type { SessionService } from '../services/SessionService.js'
import { setSessionCookie } from '../utils/cookies.js'

/**
 * Handler for BRC-100 wallet authentication.
 *
 * When a request arrives at POST /brc100/session with valid BRC-100 mutual auth
 * headers (handled by auth-express-middleware), this handler issues a session JWT
 * for the authenticated identity key. No managed wallet is created — this is a
 * self-sovereign user.
 */
export function createBRC100SessionHandler(
  userService: UserService,
  sessionService: SessionService
) {
  return async (req: AuthBridgeRequest, res: Response, next: NextFunction) => {
    try {
      const identityKey = req.auth?.identityKey
      if (!identityKey || identityKey === 'unknown') {
        res.status(401).json({ error: 'BRC-100 mutual authentication required' })
        return
      }

      // Look up existing user by identity key, or create a lightweight record
      let user = await userService.findByIdentityKey(identityKey)
      let isNewUser = false

      if (!user) {
        isNewUser = true
        // Create a user record with no root key (self-sovereign — we don't manage keys)
        const { getDb } = await import('../db/knex.js')
        const db = getDb()
        const result = await db('auth_bridge_users').insert({
          identity_key: identityKey,
          root_key_enc: Buffer.alloc(0),
          root_key_iv: Buffer.alloc(0),
          chain: 'main',
          custody_status: 'sovereign'
        })
        const insertId = Array.isArray(result) ? result[0] : result
        user = await userService.findById(typeof insertId === 'number' ? insertId : (insertId as any).id)
      }

      if (!user) {
        res.status(500).json({ error: 'Failed to create user record' })
        return
      }

      // Issue a non-managed session
      const token = await sessionService.create(
        user.id,
        user.identity_key,
        'brc100',
        false // not a managed wallet
      )

      setSessionCookie(res, token)

      res.json({
        token,
        session: {
          identityKey: user.identity_key,
          authMethod: 'brc100',
          isManagedWallet: false,
          isNewUser
        }
      })
    } catch (err) {
      next(err)
    }
  }
}
