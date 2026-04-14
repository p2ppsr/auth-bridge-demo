import type { WalletInterface } from '@bsv/sdk'
import type { KeyEncryptor } from '../types.js'
import { getDb } from '../db/knex.js'

// Lazy import to avoid pulling wallet-toolbox at module load time
let _SetupClient: any

async function getSetupClient() {
  if (!_SetupClient) {
    const mod = await import('@bsv/wallet-toolbox')
    _SetupClient = mod.SetupClient
  }
  return _SetupClient
}

interface CachedWallet {
  wallet: WalletInterface
  identityKey: string
  expiresAt: number
}

/**
 * LRU-style pool of managed wallet instances, keyed by user ID.
 * Wallets are instantiated on demand from encrypted root keys in the DB
 * and cached for the duration of the session TTL.
 */
export class WalletPool {
  private cache = new Map<number, CachedWallet>()
  private maxSize: number
  private ttlMs: number
  private keyEncryptor: KeyEncryptor
  private chain: 'main' | 'test'
  private storageUrl: string

  constructor(opts: {
    keyEncryptor: KeyEncryptor
    chain: 'main' | 'test'
    storageUrl: string
    maxSize?: number
    ttlMs?: number
  }) {
    this.keyEncryptor = opts.keyEncryptor
    this.chain = opts.chain
    this.storageUrl = opts.storageUrl
    this.maxSize = opts.maxSize ?? 100
    this.ttlMs = opts.ttlMs ?? 3600_000
  }

  /**
   * Get or create a managed wallet for the given user ID.
   */
  async getWallet(userId: number): Promise<{ wallet: WalletInterface; identityKey: string }> {
    const now = Date.now()

    // Check cache
    const cached = this.cache.get(userId)
    if (cached && cached.expiresAt > now) {
      return { wallet: cached.wallet, identityKey: cached.identityKey }
    }

    // Load from DB
    const db = getDb()
    const user = await db('auth_bridge_users').where({ id: userId }).first()
    if (!user) throw new Error(`Auth bridge user not found: ${userId}`)
    if (user.custody_status === 'sovereign') {
      throw new Error(`User ${userId} has migrated to self-sovereign. Use BRC-100 wallet auth.`)
    }

    // Decrypt root key
    const rootKeyBytes = await this.keyEncryptor.decrypt(
      new Uint8Array(user.root_key_enc),
      new Uint8Array(user.root_key_iv)
    )
    const rootKeyHex = Buffer.from(rootKeyBytes).toString('hex')

    // Instantiate wallet via wallet-toolbox
    const SetupClient = await getSetupClient()
    const wallet: WalletInterface = await SetupClient.createWalletClientNoEnv({
      chain: this.chain,
      rootKeyHex,
      storageUrl: this.storageUrl
    })

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) this.cache.delete(oldestKey)
    }

    const entry: CachedWallet = {
      wallet,
      identityKey: user.identity_key,
      expiresAt: now + this.ttlMs
    }
    this.cache.set(userId, entry)

    return { wallet: entry.wallet, identityKey: entry.identityKey }
  }

  /**
   * Create a new managed wallet for a first-time user.
   * Returns the user row ID, identity key, and wallet instance.
   */
  async createWallet(): Promise<{
    rootKeyHex: string
    identityKey: string
    wallet: WalletInterface
  }> {
    const { randomBytes } = await import('crypto')
    const rootKeyHex = randomBytes(32).toString('hex')

    const { PrivateKey } = await import('@bsv/sdk')
    const identityKey = PrivateKey.fromHex(rootKeyHex).toPublicKey().toString()

    const SetupClient = await getSetupClient()
    const wallet: WalletInterface = await SetupClient.createWalletClientNoEnv({
      chain: this.chain,
      rootKeyHex,
      storageUrl: this.storageUrl
    })

    return { rootKeyHex, identityKey, wallet }
  }

  /**
   * Store a newly created wallet's encrypted root key in the DB.
   */
  async persistUser(rootKeyHex: string, identityKey: string): Promise<number> {
    const rootKeyBytes = new Uint8Array(Buffer.from(rootKeyHex, 'hex'))
    const { ciphertext, iv } = await this.keyEncryptor.encrypt(rootKeyBytes)

    const db = getDb()
    const result = await db('auth_bridge_users')
      .insert({
        identity_key: identityKey,
        root_key_enc: Buffer.from(ciphertext),
        root_key_iv: Buffer.from(iv),
        chain: this.chain,
        custody_status: 'managed'
      })

    // Knex returns [insertId] for MySQL/SQLite inserts
    const insertId = Array.isArray(result) ? result[0] : result
    return typeof insertId === 'number' ? insertId : (insertId as any).id
  }

  /** Evict a user from the cache (e.g. on logout or migration) */
  evict(userId: number): void {
    this.cache.delete(userId)
  }
}
