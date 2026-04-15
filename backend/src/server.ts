import dotenv from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Load .env from the example root (one level above backend/)
dotenv.config({ path: resolve(__dirname, '../../.env') })
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { createAuthBridge } from '@bsv/auth-bridge-express'
import { PrivateKey } from '@bsv/sdk'

const PORT = Number(process.env.PORT ?? 3001)
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173'
const AUTH_BASE_URL = process.env.AUTH_BASE_URL ?? `http://localhost:${PORT}/auth`

async function main() {
  const app = express()

  app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
  }))
  app.use(express.json())
  app.use(cookieParser())

  // ── Server wallet (simplified for example) ──────────────────────────
  // In production, this would be a fully configured BRC-100 wallet.
  // For the example, we create a minimal mock that satisfies the interface.
  const serverKeyHex = process.env.SERVER_WALLET_KEY
  if (!serverKeyHex) {
    console.error('Missing SERVER_WALLET_KEY in .env — generate one with:')
    console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
    process.exit(1)
  }

  // Create a real wallet using wallet-toolbox
  let serverWallet: any
  try {
    const { SetupClient } = await import('@bsv/wallet-toolbox')
    const storageUrl = process.env.STORAGE_URL ?? 'https://staging-storage.babbage.systems'
    serverWallet = await SetupClient.createWalletClientNoEnv({
      chain: (process.env.BSV_CHAIN as 'main' | 'test') ?? 'test',
      rootKeyHex: serverKeyHex,
      storageUrl
    })
    const identityKey = PrivateKey.fromHex(serverKeyHex).toPublicKey().toString()
    console.log(`Server wallet identity key: ${identityKey}`)
  } catch (err) {
    console.warn('Could not create full wallet-toolbox wallet, using minimal stub:', err)
    // Minimal stub for development when wallet-toolbox storage isn't available
    const identityKey = PrivateKey.fromHex(serverKeyHex).toPublicKey().toString()
    serverWallet = {
      getPublicKey: async () => ({ publicKey: identityKey }),
      isAuthenticated: async () => ({ authenticated: true }),
      getHeight: async () => ({ height: 0 }),
      getNetwork: async () => ({ network: 'testnet' }),
      getVersion: async () => ({ version: '1.0.0' })
    }
    console.log(`Server wallet (stub) identity key: ${identityKey}`)
  }

  // ── Email sender (logs to console for local dev) ────────────────────
  const emailSendLink = async (email: string, url: string) => {
    console.log('\n══════════════════════════════════════════════════')
    console.log(`  MAGIC LINK for ${email}`)
    console.log(`  ${url}`)
    console.log('══════════════════════════════════════════════════\n')
    // In production, use nodemailer, SendGrid, Resend, etc.
  }

  // ── Auth Bridge ─────────────────────────────────────────────────────
  const { router: authRouter, sessionMiddleware, brc100Middleware } = await createAuthBridge({
    serverWallet,
    chain: (process.env.BSV_CHAIN as 'main' | 'test') ?? 'test',

    knexConfig: {
      client: 'mysql2',
      connection: process.env.DB_SOCKET_PATH
        ? {
            // Cloud SQL via Unix socket (Cloud Run with --add-cloudsql-instances)
            socketPath: process.env.DB_SOCKET_PATH,
            user: process.env.DB_USER ?? 'authbridge',
            password: process.env.DB_PASSWORD ?? 'authbridge',
            database: process.env.DB_NAME ?? 'auth_bridge'
          }
        : {
            host: process.env.DB_HOST ?? '127.0.0.1',
            port: Number(process.env.DB_PORT ?? 3306),
            user: process.env.DB_USER ?? 'authbridge',
            password: process.env.DB_PASSWORD ?? 'authbridge',
            database: process.env.DB_NAME ?? 'auth_bridge'
          }
    },

    storageUrl: process.env.STORAGE_URL ?? 'https://staging-storage.babbage.systems',

    // Fund newly created managed wallets (optional)
    fundingWalletKey: process.env.FUNDING_WALLET_KEY,
    fundAmountSats: process.env.FUND_AMOUNT_SATS
      ? Number(process.env.FUND_AMOUNT_SATS)
      : 5000,

    // Google (optional — only enabled if env vars are set)
    google: process.env.GOOGLE_CLIENT_ID
      ? {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!
        }
      : undefined,

    // Email magic link (always enabled — logs to console)
    email: { sendLink: emailSendLink },

    allowBRC100: true,

    jwtSecret: process.env.AUTH_BRIDGE_JWT_SECRET,
    baseUrl: AUTH_BASE_URL,

    logger: console
  })

  // BRC-100 middleware at root so /.well-known/auth is reachable
  if (brc100Middleware) app.use(brc100Middleware)
  // Session middleware runs after — if it finds a valid JWT cookie,
  // it overwrites the 'unknown' identityKey that brc100 middleware sets
  // on non-BRC-100 requests
  app.use(sessionMiddleware)
  app.use('/auth', authRouter)

  // ── Example protected route ─────────────────────────────────────────
  app.get('/api/me', (req: any, res) => {
    if (!req.auth?.identityKey || req.auth.identityKey === 'unknown') {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    res.json({
      identityKey: req.auth.identityKey,
      authMethod: req.authBridge?.authMethod,
      isManagedWallet: req.authBridge?.isManagedWallet,
      message: 'You are authenticated!'
    })
  })

  // ── Health check ────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.listen(PORT, () => {
    console.log(`\nAuth Bridge Example Backend`)
    console.log(`  Server:   http://localhost:${PORT}`)
    console.log(`  Frontend: ${FRONTEND_URL}`)
    console.log(`  Auth URL: ${AUTH_BASE_URL}`)
    console.log(`  Health:   http://localhost:${PORT}/health`)
    console.log(`  Google:   ${process.env.GOOGLE_CLIENT_ID ? 'enabled' : 'disabled (set GOOGLE_CLIENT_ID)'}`)
    console.log(`  Email:    enabled (magic links logged to console)`)
    console.log()
  })
}

main().catch(err => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
