import type { Response, NextFunction } from 'express'
import type { AuthBridgeRequest } from '../types.js'
import type { SessionService } from '../services/SessionService.js'
import type { WalletPool } from '../managed-wallet/WalletPool.js'
import { setSessionCookie } from '../utils/cookies.js'

export function createSessionHandlers(
  sessionService: SessionService,
  walletPool: WalletPool
) {
  return {
    /**
     * GET /session
     * Returns current session info, or 401 if not authenticated.
     */
    async get(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authBridge) {
          res.status(401).json({ error: 'Not authenticated' })
          return
        }

        // If authenticated via Bearer token but no cookie, set the cookie
        // so subsequent requests (e.g. from regular fetch) are authenticated
        const hasCookie = !!(req as any).cookies?.auth_bridge_session
        const bearerToken = req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.slice(7)
          : undefined
        if (!hasCookie && bearerToken) {
          setSessionCookie(res, bearerToken)
        }

        res.json({
          identityKey: req.auth?.identityKey,
          authMethod: req.authBridge.authMethod,
          isManagedWallet: req.authBridge.isManagedWallet,
          userId: req.authBridge.userId
        })
      } catch (err) {
        next(err)
      }
    },

    /**
     * POST /logout
     * Destroys the current session.
     */
    async logout(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        // Extract the JWT to find the session ID
        const cookieToken = (req as any).cookies?.auth_bridge_session
        const headerToken = req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.slice(7)
          : undefined
        const token = cookieToken || headerToken

        if (token) {
          const payload = await sessionService.verify(token)
          if (payload) {
            await sessionService.destroy(payload.jti)
            if (req.authBridge?.userId) {
              walletPool.evict(req.authBridge.userId)
            }
          }
        }

        res.clearCookie('auth_bridge_session', { path: '/' })
        res.json({ message: 'Logged out' })
      } catch (err) {
        next(err)
      }
    }
  }
}
