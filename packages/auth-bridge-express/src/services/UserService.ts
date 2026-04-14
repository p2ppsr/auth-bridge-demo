import { getDb } from '../db/knex.js'
import type { DbUser, DbAuthMethod } from '../types.js'

export class UserService {
  /** Find user by auth method (e.g. google sub ID or email address) */
  async findByAuthMethod(methodType: string, methodId: string): Promise<DbUser | undefined> {
    const db = getDb()
    const method = await db('auth_bridge_auth_methods')
      .where({ method_type: methodType, method_id: methodId })
      .first() as DbAuthMethod | undefined

    if (!method) return undefined
    return db('auth_bridge_users').where({ id: method.user_id }).first()
  }

  /** Find user by ID */
  async findById(id: number): Promise<DbUser | undefined> {
    return getDb()('auth_bridge_users').where({ id }).first()
  }

  /** Find user by identity key */
  async findByIdentityKey(identityKey: string): Promise<DbUser | undefined> {
    return getDb()('auth_bridge_users').where({ identity_key: identityKey }).first()
  }

  /** Link an auth method to a user */
  async addAuthMethod(userId: number, methodType: string, methodId: string): Promise<void> {
    await getDb()('auth_bridge_auth_methods').insert({
      user_id: userId,
      method_type: methodType,
      method_id: methodId
    })
  }

  /** List all auth methods for a user */
  async getAuthMethods(userId: number): Promise<DbAuthMethod[]> {
    return getDb()('auth_bridge_auth_methods').where({ user_id: userId })
  }

  /** Update user's custody status */
  async setCustodyStatus(userId: number, status: 'managed' | 'sovereign'): Promise<void> {
    await getDb()('auth_bridge_users')
      .where({ id: userId })
      .update({ custody_status: status, updated_at: getDb().fn.now() })
  }

  /** Zero out the encrypted root key (post-migration) */
  async clearRootKey(userId: number): Promise<void> {
    const zeroed = Buffer.alloc(32, 0)
    await getDb()('auth_bridge_users')
      .where({ id: userId })
      .update({
        root_key_enc: zeroed,
        root_key_iv: zeroed,
        custody_status: 'sovereign',
        updated_at: getDb().fn.now()
      })
  }
}
