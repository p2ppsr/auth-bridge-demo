import type { Response, NextFunction } from 'express'
import type { AuthBridgeRequest } from '../types.js'
import type { UserService } from '../services/UserService.js'
import type { SessionService } from '../services/SessionService.js'
import type { WalletPool } from '../managed-wallet/WalletPool.js'
import { getDb } from '../db/knex.js'

export function createMigrateHandlers(
  userService: UserService,
  sessionService: SessionService,
  walletPool: WalletPool
) {
  return {
    /**
     * GET /migrate/plan
     *
     * Summarizes what will be transferred during migration.
     */
    async plan(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authBridge?.isManagedWallet || !req.authBridge.managedWallet) {
          res.status(401).json({ error: 'Must be authenticated with a managed wallet' })
          return
        }
        const wallet = req.authBridge.managedWallet as any

        const baskets: Array<{ basket: string; count: number; totalSats: number }> = []
        for (const basket of ['default', 'todo tokens']) {
          try {
            const result = await wallet.listOutputs({ basket, limit: 1000 })
            const totalSats = result.outputs.reduce((s: number, o: any) => s + (o.satoshis || 0), 0)
            if (result.outputs.length > 0) baskets.push({ basket, count: result.outputs.length, totalSats })
          } catch { /* basket may not exist */ }
        }

        const totalSats = baskets.reduce((s, b) => s + b.totalSats, 0)
        res.json({ baskets, totalSats })
      } catch (err) { next(err) }
    },

    /**
     * POST /migrate/transfer-funds
     * Body: { targetIdentityKey: string }
     *
     * Creates a BRC-29 payment from the managed wallet's default basket to the
     * target BRC-100 wallet. Returns the atomic BEEF + remittance so the client
     * can call internalizeAction on the target wallet.
     */
    async transferFunds(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authBridge?.isManagedWallet || !req.authBridge.managedWallet || !req.authBridge.userId) {
          res.status(401).json({ error: 'Must be authenticated with a managed wallet' })
          return
        }

        const { targetIdentityKey } = req.body
        if (!targetIdentityKey || typeof targetIdentityKey !== 'string' || targetIdentityKey.length !== 66) {
          res.status(400).json({ error: 'Invalid targetIdentityKey' })
          return
        }

        const managedWallet = req.authBridge.managedWallet as any

        const outputsResult = await managedWallet.listOutputs({ basket: 'default', limit: 1000 })
        const totalAvailable = outputsResult.outputs.reduce((s: number, o: any) => s + (o.satoshis || 0), 0)
        if (totalAvailable <= 0) {
          res.json({ transferred: 0, message: 'No funds to transfer' })
          return
        }

        const wt = await import('@bsv/wallet-toolbox')
        const { randomBytesBase64, ScriptTemplateBRC29 } = wt as any

        const keyDeriver = (managedWallet as any).keyDeriver
        if (!keyDeriver) {
          res.status(500).json({ error: 'Managed wallet missing keyDeriver' })
          return
        }

        const derivationPrefix = randomBytesBase64(8)
        const derivationSuffix = randomBytesBase64(8)
        const template = new ScriptTemplateBRC29({ derivationPrefix, derivationSuffix, keyDeriver })

        // Leave a fee buffer; wallet-toolbox needs enough to cover the fee.
        // A single-input, 1-output BRC-29 tx costs roughly 500-1000 sats.
        // Whatever is left over ends up as change in the managed wallet.
        const FEE_BUFFER = 1500
        const sendAll = totalAvailable - FEE_BUFFER
        if (sendAll < 546) {
          res.json({ transferred: 0, message: `Not enough funds to cover transaction fee (need > ${546 + FEE_BUFFER} sats, have ${totalAvailable})` })
          return
        }

        const car = await managedWallet.createAction({
          outputs: [{
            lockingScript: template.lock(keyDeriver.rootKey.toString(), targetIdentityKey).toHex(),
            satoshis: sendAll,
            outputDescription: 'migrate-funds',
            customInstructions: JSON.stringify({ derivationPrefix, derivationSuffix, type: 'BRC29' })
          }],
          options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
          description: 'Migrate funds to self-sovereign wallet'
        })

        if (!car.tx || !car.txid) {
          res.status(500).json({ error: 'Failed to create funds transfer transaction' })
          return
        }

        res.json({
          tx: Array.from(car.tx),
          txid: car.txid,
          vout: 0,
          satoshis: sendAll,
          derivationPrefix,
          derivationSuffix,
          senderIdentityKey: keyDeriver.identityKey
        })
      } catch (err) { next(err) }
    },

    /**
     * GET /migrate/todos
     *
     * Returns decrypted todos from the managed wallet so the client can
     * re-create them in the target wallet.
     */
    async todos(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authBridge?.isManagedWallet || !req.authBridge.managedWallet) {
          res.status(401).json({ error: 'Must be authenticated with a managed wallet' })
          return
        }
        const wallet = req.authBridge.managedWallet as any
        const { PushDrop, Transaction, Utils } = await import('@bsv/sdk')

        let result: any
        try {
          result = await wallet.listOutputs({ basket: 'todo tokens', include: 'entire transactions', limit: 1000 })
        } catch {
          res.json({ todos: [] })
          return
        }

        const todos: Array<{ task: string; sats: number }> = []
        for (const o of result.outputs) {
          try {
            const txid = o.outpoint.split('.')[0]
            const tx = Transaction.fromBEEF(result.BEEF as number[], txid)
            if (!tx) continue
            const ls = tx.outputs[0].lockingScript
            const drop = PushDrop.decode(ls)
            const dec = await wallet.decrypt({
              ciphertext: drop.fields[1],
              protocolID: [0, 'todo list'],
              keyID: '1'
            })
            todos.push({ task: Utils.toUTF8(dec.plaintext), sats: o.satoshis ?? 0 })
          } catch { /* skip unreadable */ }
        }

        res.json({ todos })
      } catch (err) { next(err) }
    },

    /**
     * POST /migrate/finalize
     * Body: { targetIdentityKey: string }
     *
     * Marks migration complete. Zeros server key, destroys sessions.
     */
    async finalize(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authBridge?.isManagedWallet || !req.authBridge.userId) {
          res.status(401).json({ error: 'Must be authenticated with a managed wallet' })
          return
        }

        const { targetIdentityKey } = req.body
        if (!targetIdentityKey || typeof targetIdentityKey !== 'string' || targetIdentityKey.length !== 66) {
          res.status(400).json({ error: 'Invalid targetIdentityKey' })
          return
        }

        const userId = req.authBridge.userId
        const db = getDb()

        await db('auth_bridge_migrations').insert({
          user_id: userId,
          target_identity_key: targetIdentityKey,
          status: 'complete',
          completed_at: db.fn.now()
        })

        await userService.clearRootKey(userId)
        await sessionService.destroyAllForUser(userId)
        walletPool.evict(userId)

        res.clearCookie('auth_bridge_session', { path: '/' })
        res.json({ status: 'complete' })
      } catch (err) { next(err) }
    },

    // Legacy endpoints kept for backwards compat with existing frontend code
    async initiate(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authBridge?.isManagedWallet || !req.authBridge.userId) {
          res.status(401).json({ error: 'Must be authenticated with a managed wallet' })
          return
        }
        const { targetIdentityKey } = req.body
        if (!targetIdentityKey) { res.status(400).json({ error: 'Missing targetIdentityKey' }); return }
        res.json({ migrationId: 0, status: 'initiated' })
      } catch (err) { next(err) }
    },

    async complete(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        res.status(410).json({ error: 'Use /migrate/transfer-funds, /migrate/todos, and /migrate/finalize instead' })
      } catch (err) { next(err) }
    },

    async status(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authBridge?.userId) { res.status(401).json({ error: 'Not authenticated' }); return }
        const migration = await getDb()('auth_bridge_migrations')
          .where({ user_id: req.authBridge.userId })
          .orderBy('id', 'desc')
          .first()
        if (!migration) { res.json({ hasMigration: false }); return }
        res.json({
          hasMigration: true,
          migrationId: migration.id,
          status: migration.status,
          targetIdentityKey: migration.target_identity_key,
          completedAt: migration.completed_at
        })
      } catch (err) { next(err) }
    }
  }
}
