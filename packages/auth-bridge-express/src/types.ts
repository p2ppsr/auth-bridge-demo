import type { Request } from 'express'
import type { WalletInterface, PubKeyHex } from '@bsv/sdk'
import type { Knex } from 'knex'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface KeyEncryptor {
  encrypt(plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }>
  decrypt(ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array>
}

export interface GoogleProviderConfig {
  clientId: string
  clientSecret: string
}

export interface EmailProviderConfig {
  /** Called when a magic link needs to be sent. The `url` is the full verification URL. */
  sendLink: (email: string, url: string) => Promise<void>
}

export interface AuthBridgeOptions {
  /** Server's own BRC-100 wallet for managed wallet operations and migration */
  serverWallet: WalletInterface
  /** Chain to use for managed wallets */
  chain: 'main' | 'test'
  /** Knex configuration for the auth bridge database */
  knexConfig: Knex.Config
  /** Endpoint URL for wallet-toolbox remote storage */
  storageUrl: string

  /** Google OAuth provider config. Omit to disable Google auth. */
  google?: GoogleProviderConfig
  /** Email magic link provider config. Omit to disable email auth. */
  email?: EmailProviderConfig

  /** Accept native BRC-100 wallet auth alongside traditional auth (default: true) */
  allowBRC100?: boolean

  /** Custom key encryptor. Defaults to AES-256-GCM using AUTH_BRIDGE_KEY env var. */
  keyEncryptor?: KeyEncryptor

  /** JWT secret for session tokens. Defaults to AUTH_BRIDGE_JWT_SECRET env var. */
  jwtSecret?: string
  /** Session TTL in seconds (default: 3600 — 1 hour) */
  sessionTTLSeconds?: number

  /** Base URL of the server, used for constructing callback URLs */
  baseUrl?: string

  logger?: {
    debug: (...args: any[]) => void
    info: (...args: any[]) => void
    warn: (...args: any[]) => void
    error: (...args: any[]) => void
  }
}

// ---------------------------------------------------------------------------
// Request extension
// ---------------------------------------------------------------------------

export interface AuthBridgeInfo {
  authMethod: 'google' | 'email' | 'brc100'
  isManagedWallet: boolean
  userId?: number
  managedWallet?: WalletInterface
}

export interface AuthBridgeRequest extends Request {
  auth?: {
    identityKey: PubKeyHex | 'unknown'
  }
  authBridge?: AuthBridgeInfo
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface SessionPayload {
  sub: string        // user ID
  ik: string         // identity key
  am: string         // auth method
  managed: boolean
}

// ---------------------------------------------------------------------------
// Database row types
// ---------------------------------------------------------------------------

export interface DbUser {
  id: number
  identity_key: string
  root_key_enc: Buffer
  root_key_iv: Buffer
  chain: string
  custody_status: 'managed' | 'sovereign'
  created_at: string
  updated_at: string
}

export interface DbAuthMethod {
  id: number
  user_id: number
  method_type: string
  method_id: string
  created_at: string
}

export interface DbSession {
  id: string
  user_id: number
  expires_at: string
  created_at: string
}

export interface DbMagicLink {
  token: string
  email: string
  verified: boolean
  expires_at: string
}

export interface DbMigration {
  id: number
  user_id: number
  target_identity_key: string
  status: 'initiated' | 'utxos_transferred' | 'certs_transferred' | 'complete'
  completed_at: string | null
}
