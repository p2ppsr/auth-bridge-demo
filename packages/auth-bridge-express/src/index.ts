import type { AuthBridgeOptions } from './types.js'
import { buildRouter, type AuthBridgeResult } from './router.js'

/**
 * Create the Auth Bridge Express router and session middleware.
 *
 * Returns an object with:
 * - `router`: Mount at your auth path (e.g. `app.use('/auth', router)`)
 * - `sessionMiddleware`: Mount globally so non-auth routes get `req.auth` populated
 *
 * @example
 * ```typescript
 * import express from 'express'
 * import { createAuthBridge } from '@bsv/auth-bridge-express'
 *
 * const app = express()
 *
 * const { router, sessionMiddleware } = await createAuthBridge({
 *   serverWallet: myWallet,
 *   chain: 'main',
 *   knexConfig: { client: 'better-sqlite3', connection: { filename: './auth.db' } },
 *   storageUrl: 'https://storage.example.com',
 *   google: { clientId: '...', clientSecret: '...' },
 *   email: { sendLink: async (email, url) => sendEmail(email, url) },
 * })
 *
 * app.use(sessionMiddleware)  // populates req.auth on ALL routes
 * app.use('/auth', router)
 *
 * // Downstream routes see req.auth.identityKey regardless of auth method
 * app.get('/api/data', (req, res) => {
 *   const userKey = req.auth?.identityKey
 *   const isCustodial = req.authBridge?.isManagedWallet
 * })
 * ```
 */
export async function createAuthBridge(options: AuthBridgeOptions): Promise<AuthBridgeResult> {
  return buildRouter(options)
}

/** @deprecated Use createAuthBridge() instead */
export async function createAuthBridgeRouter(options: AuthBridgeOptions): Promise<AuthBridgeResult> {
  return buildRouter(options)
}

// Re-export types
export type {
  AuthBridgeOptions,
  AuthBridgeRequest,
  AuthBridgeInfo,
  SessionPayload,
  KeyEncryptor,
  GoogleProviderConfig,
  EmailProviderConfig
} from './types.js'

// Re-export utilities for advanced usage
export { createDefaultKeyEncryptor } from './managed-wallet/KeyVault.js'
export { WalletPool } from './managed-wallet/WalletPool.js'
export { UserService } from './services/UserService.js'
export { SessionService } from './services/SessionService.js'
