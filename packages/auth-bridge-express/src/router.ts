import { Router, json } from 'express'
import type { AuthBridgeOptions } from './types.js'
import { initDb, getDb } from './db/knex.js'
import { createDefaultKeyEncryptor } from './managed-wallet/KeyVault.js'
import { WalletPool } from './managed-wallet/WalletPool.js'
import { UserService } from './services/UserService.js'
import { SessionService } from './services/SessionService.js'
import { createSessionMiddleware } from './middleware/sessionMiddleware.js'
import { createGoogleHandler } from './handlers/google.js'
import { createEmailHandlers } from './handlers/email.js'
import { createSessionHandlers } from './handlers/session.js'
import { createMigrateHandlers } from './handlers/migrate.js'
import { createBRC100SessionHandler } from './handlers/brc100.js'
import { createWalletProxyHandler } from './handlers/walletProxy.js'
import * as migration001 from './db/migrations/001-initial.js'

export interface AuthBridgeResult {
  /** Router to mount at your auth path (e.g. app.use('/auth', router)) */
  router: Router
  /** Session middleware to mount globally so non-auth routes get req.auth populated */
  sessionMiddleware: ReturnType<typeof createSessionMiddleware>
  /** BRC-100 auth middleware — mount at app root so /.well-known/auth is accessible to AuthFetch */
  brc100Middleware?: any
}

export async function buildRouter(options: AuthBridgeOptions): Promise<AuthBridgeResult> {
  const router = Router()
  router.use(json())

  const logger = options.logger ?? console

  // ── Database ──────────────────────────────────────────────────────────
  const db = initDb(options.knexConfig)

  // Run migrations
  try {
    const hasTable = await db.schema.hasTable('auth_bridge_users')
    if (!hasTable) {
      logger.info('[auth-bridge] Running database migrations...')
      await migration001.up(db)
      logger.info('[auth-bridge] Migrations complete.')
    }
  } catch (err) {
    logger.error('[auth-bridge] Migration failed:', err)
    throw err
  }

  // ── Services ──────────────────────────────────────────────────────────
  const keyEncryptor = options.keyEncryptor ?? createDefaultKeyEncryptor()
  const sessionTTL = options.sessionTTLSeconds ?? 3600
  const jwtSecret = options.jwtSecret ?? process.env.AUTH_BRIDGE_JWT_SECRET
  if (!jwtSecret) {
    throw new Error('Auth bridge requires a JWT secret. Set AUTH_BRIDGE_JWT_SECRET env var or pass jwtSecret option.')
  }

  const walletPool = new WalletPool({
    keyEncryptor,
    chain: options.chain,
    storageUrl: options.storageUrl,
    fundingWalletKey: options.fundingWalletKey,
    fundAmountSats: options.fundAmountSats,
    ttlMs: sessionTTL * 1000,
    logger
  })
  if (options.fundingWalletKey) {
    logger.info(`[auth-bridge] Funding wallet enabled (${options.fundAmountSats ?? 5000} sats per new user)`)
  }

  const userService = new UserService()
  const sessionService = new SessionService(jwtSecret, sessionTTL)
  const baseUrl = options.baseUrl ?? ''

  // ── Session middleware (validates JWT on all requests) ─────────────────
  const sessionMw = createSessionMiddleware(sessionService, walletPool)
  router.use(sessionMw)

  // ── Google OAuth ──────────────────────────────────────────────────────
  if (options.google) {
    router.post(
      '/google/callback',
      createGoogleHandler(options.google, userService, sessionService, walletPool, baseUrl)
    )
    logger.info('[auth-bridge] Google OAuth enabled')
  }

  // ── Email magic link ──────────────────────────────────────────────────
  if (options.email) {
    const emailHandlers = createEmailHandlers(options.email, userService, sessionService, walletPool, baseUrl)
    router.post('/email/send', emailHandlers.send)
    router.get('/email/verify/:token', emailHandlers.verify)
    router.post('/email/poll', emailHandlers.poll)
    logger.info('[auth-bridge] Email magic link enabled')
  }

  // ── Session endpoints ─────────────────────────────────────────────────
  const sessionHandlers = createSessionHandlers(sessionService, walletPool)
  router.get('/session', sessionHandlers.get)
  router.post('/logout', sessionHandlers.logout)

  // ── Wallet proxy (managed wallet RPC) ──────────────────────────────────
  router.post('/wallet/call', createWalletProxyHandler())

  // ── Migration endpoints ───────────────────────────────────────────────
  const migrateHandlers = createMigrateHandlers(userService, sessionService, walletPool)
  router.get('/migrate/plan', migrateHandlers.plan)
  router.post('/migrate/transfer-funds', migrateHandlers.transferFunds)
  router.get('/migrate/todos', migrateHandlers.todos)
  router.post('/migrate/finalize', migrateHandlers.finalize)
  router.post('/migrate/initiate', migrateHandlers.initiate) // legacy
  router.post('/migrate/complete', migrateHandlers.complete) // legacy
  router.get('/migrate/status', migrateHandlers.status)

  // ── BRC-100 native auth (delegates to auth-express-middleware) ────────
  let brc100Mw: any
  if (options.allowBRC100 !== false) {
    try {
      const { createAuthMiddleware } = await import('@bsv/auth-express-middleware')
      brc100Mw = createAuthMiddleware({
        wallet: options.serverWallet,
        allowUnauthenticated: true
      })

      // BRC-100 session endpoint — sits behind the auth middleware on the router
      // The brc100Mw itself should be mounted at the app root by the consumer
      // so that /.well-known/auth is accessible to AuthFetch clients.
      router.post('/brc100/session', createBRC100SessionHandler(userService, sessionService))

      logger.info('[auth-bridge] BRC-100 native auth enabled')
    } catch (err) {
      logger.warn('[auth-bridge] @bsv/auth-express-middleware not available, BRC-100 auth disabled:', err)
    }
  }

  // ── Periodic cleanup ──────────────────────────────────────────────────
  setInterval(async () => {
    try {
      const cleaned = await sessionService.cleanup()
      if (cleaned > 0) logger.debug(`[auth-bridge] Cleaned ${cleaned} expired sessions`)
    } catch { /* ignore cleanup errors */ }
  }, 60_000)

  return { router, sessionMiddleware: sessionMw, brc100Middleware: brc100Mw }
}
