import type { Response, NextFunction } from 'express'
import type { AuthBridgeRequest, AuthBridgeInfo } from '../types.js'
import type { SessionService } from '../services/SessionService.js'
import type { WalletPool } from '../managed-wallet/WalletPool.js'

/**
 * Express middleware that validates the session JWT (from cookie or Authorization header)
 * and populates req.auth and req.authBridge for downstream handlers.
 */
export function createSessionMiddleware(
  sessionService: SessionService,
  walletPool: WalletPool
) {
  return async (req: AuthBridgeRequest, res: Response, next: NextFunction) => {
    // Extract token from cookie or Authorization header
    const cookieToken = (req as any).cookies?.auth_bridge_session
    const headerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined
    const token = cookieToken || headerToken

    if (!token) {
      return next()
    }

    try {
      const payload = await sessionService.verify(token)
      if (!payload) {
        return next()
      }

      // Populate req.auth (compatible with @bsv/auth-express-middleware)
      req.auth = { identityKey: payload.ik }

      const bridgeInfo: AuthBridgeInfo = {
        authMethod: payload.am as 'google' | 'email' | 'brc100',
        isManagedWallet: payload.managed,
        userId: Number(payload.sub)
      }

      // Load managed wallet if this is a traditional auth user
      if (payload.managed) {
        try {
          const { wallet } = await walletPool.getWallet(Number(payload.sub))
          bridgeInfo.managedWallet = wallet
        } catch (err) {
          // Wallet load failure shouldn't block the request — downstream can check
          // req.authBridge.managedWallet === undefined
        }
      }

      req.authBridge = bridgeInfo
      next()
    } catch {
      next()
    }
  }
}
