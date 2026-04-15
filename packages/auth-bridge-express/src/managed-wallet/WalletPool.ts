import type { WalletInterface } from '@bsv/sdk'
import type { KeyEncryptor } from '../types.js'
import { getDb } from '../db/knex.js'

// Lazy-loaded wallet-toolbox module references
let _wt: any

async function getWT() {
  if (!_wt) _wt = await import('@bsv/wallet-toolbox')
  return _wt
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
  private fundingWalletKey?: string
  private fundAmountSats: number
  private logger: {
    debug: (...a: any[]) => void
    info: (...a: any[]) => void
    warn: (...a: any[]) => void
    error: (...a: any[]) => void
  }

  /** Lazy-initialized funding wallet (shared across createWallet calls) */
  private fundingSetup: any | null = null

  constructor(opts: {
    keyEncryptor: KeyEncryptor
    chain: 'main' | 'test'
    storageUrl: string
    fundingWalletKey?: string
    fundAmountSats?: number
    maxSize?: number
    ttlMs?: number
    logger?: any
  }) {
    this.keyEncryptor = opts.keyEncryptor
    this.chain = opts.chain
    this.storageUrl = opts.storageUrl
    this.fundingWalletKey = opts.fundingWalletKey
    this.fundAmountSats = opts.fundAmountSats ?? 5000
    this.maxSize = opts.maxSize ?? 100
    this.ttlMs = opts.ttlMs ?? 3600_000
    this.logger = opts.logger ?? console
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
    const wt = await getWT()
    const wallet: WalletInterface = await wt.SetupClient.createWalletClientNoEnv({
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
   * Create a new managed wallet for a first-time user. If a funding wallet
   * is configured, immediately send `fundAmountSats` to the new wallet via BRC-29.
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

    const wt = await getWT()
    const setup = await wt.SetupClient.createWalletClient({
      chain: this.chain,
      rootKeyHex,
      endpointUrl: this.storageUrl
    })

    // Fund the new wallet if configured
    if (this.fundingWalletKey) {
      try {
        await this.fundWallet(setup, identityKey)
      } catch (err: any) {
        this.logger.warn(`[auth-bridge] Failed to fund new wallet ${identityKey.substring(0, 12)}...:`, err?.message || err)
      }
    }

    return { rootKeyHex, identityKey, wallet: setup.wallet }
  }

  /**
   * Fund a newly created wallet from the funding wallet using BRC-29.
   */
  private async fundWallet(targetSetup: any, targetIdentityKey: string): Promise<void> {
    if (!this.fundingWalletKey) return

    const wt = await getWT()
    const { Beef, randomBytesBase64, ScriptTemplateBRC29 } = {
      ...await import('@bsv/sdk'),
      ...wt
    } as any

    // Lazy-init the funding wallet
    if (!this.fundingSetup) {
      this.fundingSetup = await wt.SetupClient.createWalletClient({
        chain: this.chain,
        rootKeyHex: this.fundingWalletKey,
        endpointUrl: this.storageUrl
      })
      this.logger.info(`[auth-bridge] Funding wallet initialized: ${this.fundingSetup.identityKey.substring(0, 12)}...`)
    }

    const fund = this.fundingSetup

    // BRC-29 output creation
    const derivationPrefix = randomBytesBase64(8)
    const derivationSuffix = randomBytesBase64(8)
    const template = new ScriptTemplateBRC29({
      derivationPrefix,
      derivationSuffix,
      keyDeriver: fund.keyDeriver
    })

    const label = 'fund-managed-wallet'
    const car = await fund.wallet.createAction({
      outputs: [
        {
          lockingScript: template.lock(fund.rootKey.toString(), targetIdentityKey).toHex(),
          satoshis: this.fundAmountSats,
          outputDescription: label,
          customInstructions: JSON.stringify({ derivationPrefix, derivationSuffix, type: 'BRC29' })
        }
      ],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
      labels: [label],
      description: label
    })

    if (!car.tx || !car.txid) {
      throw new Error('Funding action did not return a transaction')
    }

    // Have the target wallet internalize the payment
    const { Beef: BeefClass } = await import('@bsv/sdk')
    const beef = BeefClass.fromBinary(car.tx)
    const vout = 0
    const atomicBeef = beef.toBinaryAtomic(car.txid)

    await targetSetup.wallet.internalizeAction({
      tx: atomicBeef,
      outputs: [
        {
          outputIndex: vout,
          protocol: 'wallet payment',
          paymentRemittance: {
            derivationPrefix,
            derivationSuffix,
            senderIdentityKey: fund.identityKey
          }
        }
      ],
      description: 'Initial funding from auth-bridge'
    })

    this.logger.info(`[auth-bridge] Funded ${targetIdentityKey.substring(0, 12)}... with ${this.fundAmountSats} sats (${car.txid})`)
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

    const insertId = Array.isArray(result) ? result[0] : result
    return typeof insertId === 'number' ? insertId : (insertId as any).id
  }

  /** Evict a user from the cache (e.g. on logout or migration) */
  evict(userId: number): void {
    this.cache.delete(userId)
  }
}
