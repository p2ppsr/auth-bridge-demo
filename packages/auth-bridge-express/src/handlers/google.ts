import type { Response, NextFunction } from 'express'
import type { AuthBridgeRequest, GoogleProviderConfig } from '../types.js'
import type { UserService } from '../services/UserService.js'
import type { SessionService } from '../services/SessionService.js'
import type { WalletPool } from '../managed-wallet/WalletPool.js'
import { setSessionCookie } from '../utils/cookies.js'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

interface GoogleTokenResponse {
  access_token: string
  id_token: string
  token_type: string
  expires_in: number
}

interface GoogleUserInfo {
  sub: string
  email: string
  email_verified: boolean
  name?: string
  picture?: string
}

export function createGoogleHandler(
  config: GoogleProviderConfig,
  userService: UserService,
  sessionService: SessionService,
  walletPool: WalletPool,
  baseUrl: string
) {
  /**
   * POST /google/callback
   * Body: { code: string, codeVerifier: string, redirectUri: string }
   *
   * Exchanges a Google OAuth authorization code (with PKCE) for tokens,
   * fetches user info, creates or looks up the managed wallet, and returns a session.
   */
  return async (req: AuthBridgeRequest, res: Response, next: NextFunction) => {
    try {
      const { code, codeVerifier, redirectUri } = req.body
      if (!code || !codeVerifier || !redirectUri) {
        res.status(400).json({ error: 'Missing required fields: code, codeVerifier, redirectUri' })
        return
      }

      // Exchange authorization code for tokens
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier
        })
      })

      if (!tokenRes.ok) {
        const err = await tokenRes.text()
        res.status(401).json({ error: 'Google token exchange failed', details: err })
        return
      }

      const tokens: GoogleTokenResponse = await tokenRes.json() as GoogleTokenResponse

      // Fetch user info
      const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      })

      if (!userInfoRes.ok) {
        res.status(401).json({ error: 'Failed to fetch Google user info' })
        return
      }

      const googleUser: GoogleUserInfo = await userInfoRes.json() as GoogleUserInfo

      if (!googleUser.email_verified) {
        res.status(401).json({ error: 'Google email not verified' })
        return
      }

      // Look up or create user
      let user = await userService.findByAuthMethod('google', googleUser.sub)
      let isNewUser = false

      if (!user) {
        isNewUser = true
        // Create managed wallet
        const { rootKeyHex, identityKey } = await walletPool.createWallet()
        const userId = await walletPool.persistUser(rootKeyHex, identityKey)
        await userService.addAuthMethod(userId, 'google', googleUser.sub)

        // Also store email as a secondary lookup
        if (googleUser.email) {
          try {
            await userService.addAuthMethod(userId, 'email', googleUser.email)
          } catch {
            // email may already be linked to another account — non-fatal
          }
        }

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

      // Create session
      const token = await sessionService.create(
        user.id,
        user.identity_key,
        'google',
        true
      )

      setSessionCookie(res, token)

      res.json({
        token,
        session: {
          identityKey: user.identity_key,
          authMethod: 'google',
          isManagedWallet: true,
          displayName: googleUser.name,
          email: googleUser.email,
          isNewUser
        }
      })
    } catch (err) {
      next(err)
    }
  }
}
