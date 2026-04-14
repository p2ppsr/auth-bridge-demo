import type { Response, NextFunction } from 'express'
import type { AuthBridgeRequest, EmailProviderConfig } from '../types.js'
import type { UserService } from '../services/UserService.js'
import type { SessionService } from '../services/SessionService.js'
import type { WalletPool } from '../managed-wallet/WalletPool.js'
import { setSessionCookie } from '../utils/cookies.js'

/** Simple in-memory rate limiter for magic link sends */
const rateLimits = new Map<string, { count: number; resetAt: number }>()
const MAX_SENDS_PER_WINDOW = 3
const RATE_WINDOW_MS = 15 * 60 * 1000

function checkRateLimit(email: string): boolean {
  const now = Date.now()
  const entry = rateLimits.get(email)
  if (!entry || entry.resetAt < now) {
    rateLimits.set(email, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_SENDS_PER_WINDOW) return false
  entry.count++
  return true
}

export function createEmailHandlers(
  config: EmailProviderConfig,
  userService: UserService,
  sessionService: SessionService,
  walletPool: WalletPool,
  baseUrl: string
) {
  return {
    /**
     * POST /email/send
     * Body: { email: string }
     * Sends a magic link to the given email address.
     */
    async send(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        const { email } = req.body
        if (!email || typeof email !== 'string') {
          res.status(400).json({ error: 'Missing required field: email' })
          return
        }

        const normalized = email.trim().toLowerCase()

        if (!checkRateLimit(normalized)) {
          res.status(429).json({ error: 'Too many magic link requests. Try again later.' })
          return
        }

        const token = await sessionService.createMagicLink(normalized)
        const verifyUrl = `${baseUrl}/email/verify/${token}`

        await config.sendLink(normalized, verifyUrl)

        res.json({ message: 'Magic link sent', pollToken: token })
      } catch (err) {
        next(err)
      }
    },

    /**
     * GET /email/verify/:token
     * The magic link landing page. Marks the token as verified.
     */
    async verify(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        const token = req.params.token as string
        const email = await sessionService.verifyMagicLink(token)

        if (!email) {
          res.status(400).json({ error: 'Invalid or expired magic link' })
          return
        }

        // Return a simple HTML page that tells the user they can close this tab
        res.type('html').send(`
          <!DOCTYPE html>
          <html>
          <head><title>Email Verified</title></head>
          <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;">
            <div style="text-align: center;">
              <h2>Email verified!</h2>
              <p>You can close this tab and return to the app.</p>
            </div>
          </body>
          </html>
        `)
      } catch (err) {
        next(err)
      }
    },

    /**
     * POST /email/poll
     * Body: { pollToken: string }
     * Client polls this endpoint to check if the magic link has been clicked.
     * Once verified, returns a session.
     */
    async poll(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        const { pollToken } = req.body
        if (!pollToken) {
          res.status(400).json({ error: 'Missing pollToken' })
          return
        }

        const result = await sessionService.checkMagicLink(pollToken)
        if (!result.verified || !result.email) {
          res.json({ verified: false })
          return
        }

        // Email is verified — look up or create user
        let user = await userService.findByAuthMethod('email', result.email)
        let isNewUser = false

        if (!user) {
          isNewUser = true
          const { rootKeyHex, identityKey } = await walletPool.createWallet()
          const userId = await walletPool.persistUser(rootKeyHex, identityKey)
          await userService.addAuthMethod(userId, 'email', result.email)
          user = await userService.findById(userId)
        }

        if (!user) {
          res.status(500).json({ error: 'Failed to create user' })
          return
        }

        if (user.custody_status === 'sovereign') {
          res.status(400).json({
            error: 'Account has migrated to self-sovereign wallet. Please use BRC-100 wallet login.',
            identityKey: user.identity_key
          })
          return
        }

        // Delete the magic link so subsequent polls don't re-trigger user creation
        const db = (await import('../db/knex.js')).getDb()
        await db('auth_bridge_magic_links').where({ token: pollToken }).del()

        const token = await sessionService.create(
          user.id,
          user.identity_key,
          'email',
          true
        )

        setSessionCookie(res, token)

        res.json({
          verified: true,
          token,
          session: {
            identityKey: user.identity_key,
            authMethod: 'email',
            isManagedWallet: true,
            email: result.email,
            isNewUser
          }
        })
      } catch (err) {
        next(err)
      }
    }
  }
}
