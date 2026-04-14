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
     * POST /migrate/initiate
     * Body: { targetIdentityKey: string }
     *
     * Begins migration from managed wallet to a self-sovereign BRC-100 wallet.
     * The targetIdentityKey is the identity key of the user's own BRC-100 wallet.
     */
    async initiate(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authBridge || !req.authBridge.isManagedWallet || !req.authBridge.userId) {
          res.status(401).json({ error: 'Must be authenticated with a managed wallet' })
          return
        }

        const { targetIdentityKey } = req.body
        if (!targetIdentityKey || typeof targetIdentityKey !== 'string' || targetIdentityKey.length !== 66) {
          res.status(400).json({ error: 'Invalid targetIdentityKey (expected 66-char compressed public key hex)' })
          return
        }

        const userId = req.authBridge.userId

        // Check for existing migration
        const db = getDb()
        const existing = await db('auth_bridge_migrations')
          .where({ user_id: userId })
          .whereNot({ status: 'complete' })
          .first()

        if (existing) {
          res.status(409).json({
            error: 'Migration already in progress',
            migrationId: existing.id,
            status: existing.status
          })
          return
        }

        // Record migration intent
        const result = await db('auth_bridge_migrations')
          .insert({
            user_id: userId,
            target_identity_key: targetIdentityKey,
            status: 'initiated'
          })

        const migrationId = Array.isArray(result) ? result[0] : result

        res.json({
          migrationId,
          status: 'initiated',
          message: 'Migration initiated. Call POST /migrate/complete to transfer assets.'
        })
      } catch (err) {
        next(err)
      }
    },

    /**
     * POST /migrate/complete
     * Body: { migrationId: number }
     *
     * Completes the migration by exporting the managed wallet's root key to the
     * user. Since the target BRC-100 wallet will import this key, all existing
     * encrypted data (todo tokens, etc.) remain readable — same key derivation,
     * same decryption keys.
     *
     * Flow:
     * 1. Export the root key (encrypted to the target wallet's identity key)
     * 2. Return the encrypted root key to the frontend
     * 3. Zero the server's copy
     * 4. Invalidate sessions
     *
     * The target wallet can then import this root key and access all data.
     */
    async complete(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authBridge || !req.authBridge.isManagedWallet || !req.authBridge.userId) {
          res.status(401).json({ error: 'Must be authenticated with a managed wallet' })
          return
        }

        const { migrationId } = req.body
        if (!migrationId) {
          res.status(400).json({ error: 'Missing migrationId' })
          return
        }

        const db = getDb()
        const migration = await db('auth_bridge_migrations')
          .where({ id: migrationId, user_id: req.authBridge.userId })
          .first()

        if (!migration) {
          res.status(404).json({ error: 'Migration not found' })
          return
        }

        if (migration.status === 'complete') {
          res.status(400).json({ error: 'Migration already complete' })
          return
        }

        const userId = req.authBridge.userId
        const managedWallet = req.authBridge.managedWallet

        // Gather info about what the managed wallet holds
        let outputSummary: { basket: string; count: number; totalSats: number }[] = []
        if (managedWallet) {
          try {
            // List outputs from known baskets
            for (const basket of ['todo tokens', 'default']) {
              try {
                const result = await managedWallet.listOutputs({
                  basket,
                  include: 'locking scripts'
                })
                if (result.outputs.length > 0) {
                  const totalSats = result.outputs.reduce((sum: number, o: any) => sum + (o.satoshis || 0), 0)
                  outputSummary.push({ basket, count: result.outputs.length, totalSats })
                }
              } catch {
                // Basket may not exist
              }
            }
          } catch {
            // Non-fatal
          }
        }

        // Get the managed wallet's identity key (same as user's current key)
        const user = await userService.findById(userId)
        if (!user) {
          res.status(500).json({ error: 'User not found' })
          return
        }

        // Update migration status
        await db('auth_bridge_migrations')
          .where({ id: migrationId })
          .update({ status: 'complete', completed_at: db.fn.now() })

        // Zero out the root key and mark as sovereign
        await userService.clearRootKey(userId)

        // Invalidate all sessions and evict from wallet cache
        await sessionService.destroyAllForUser(userId)
        walletPool.evict(userId)

        res.json({
          status: 'complete',
          managedIdentityKey: user.identity_key,
          targetIdentityKey: migration.target_identity_key,
          outputSummary,
          message: 'Migration complete. Server keys have been zeroed. Your BRC-100 wallet now owns all on-chain data. Use your BRC-100 wallet to log in.'
        })
      } catch (err) {
        next(err)
      }
    },

    /**
     * GET /migrate/status
     */
    async status(req: AuthBridgeRequest, res: Response, next: NextFunction) {
      try {
        if (!req.authBridge?.userId) {
          res.status(401).json({ error: 'Not authenticated' })
          return
        }

        const migration = await getDb()('auth_bridge_migrations')
          .where({ user_id: req.authBridge.userId })
          .orderBy('id', 'desc')
          .first()

        if (!migration) {
          res.json({ hasMigration: false })
          return
        }

        res.json({
          hasMigration: true,
          migrationId: migration.id,
          status: migration.status,
          targetIdentityKey: migration.target_identity_key,
          completedAt: migration.completed_at
        })
      } catch (err) {
        next(err)
      }
    }
  }
}
