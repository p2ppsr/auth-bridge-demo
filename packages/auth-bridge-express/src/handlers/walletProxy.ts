import type { Response, NextFunction } from 'express'
import type { AuthBridgeRequest } from '../types.js'

/**
 * POST /wallet/call
 * Body: { method: string, params: any }
 *
 * Proxies WalletInterface method calls to the user's managed wallet.
 * This allows the frontend to use the managed wallet as if it were local.
 *
 * Only works for managed wallet users (traditional auth). BRC-100 wallet
 * users should call their wallet directly.
 */
export function createWalletProxyHandler() {
  // Allowed WalletInterface methods that can be proxied
  const ALLOWED_METHODS = new Set([
    'createAction', 'signAction', 'abortAction',
    'listActions', 'listOutputs',
    'encrypt', 'decrypt',
    'createHmac', 'verifyHmac',
    'createSignature', 'verifySignature',
    'getPublicKey', 'getVersion', 'getNetwork', 'getHeight',
    'revealCounterpartyKeyLinkage', 'revealSpecificKeyLinkage',
    'acquireCertificate', 'listCertificates', 'proveCertificate',
    'relinquishCertificate', 'discoverByIdentityKey', 'discoverByAttributes',
    'isAuthenticated', 'waitForAuthentication',
    'relinquishOutput', 'internalizeAction'
  ])

  return async (req: AuthBridgeRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.authBridge?.isManagedWallet || !req.authBridge.managedWallet) {
        res.status(401).json({ error: 'Wallet proxy only available for managed wallet users' })
        return
      }

      const { method, params } = req.body
      if (!method || typeof method !== 'string') {
        res.status(400).json({ error: 'Missing method' })
        return
      }

      if (!ALLOWED_METHODS.has(method)) {
        res.status(400).json({ error: `Method not allowed: ${method}` })
        return
      }

      const wallet = req.authBridge.managedWallet as any
      if (typeof wallet[method] !== 'function') {
        res.status(400).json({ error: `Method not found on wallet: ${method}` })
        return
      }

      const result = await wallet[method](params ?? {})
      res.json({ result })
    } catch (err: any) {
      res.status(500).json({
        error: err.message || 'Wallet call failed',
        code: err.code
      })
    }
  }
}
