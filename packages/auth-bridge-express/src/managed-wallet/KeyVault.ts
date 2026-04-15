import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import type { KeyEncryptor } from '../types.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

/**
 * Default KeyEncryptor using AES-256-GCM with a key from the AUTH_BRIDGE_KEY env var.
 * The ciphertext returned includes the GCM auth tag appended to the end.
 */
export function createDefaultKeyEncryptor(keyHex?: string): KeyEncryptor {
  const hex = keyHex ?? process.env.AUTH_BRIDGE_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      'AUTH_BRIDGE_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    )
  }
  const key = Buffer.from(hex, 'hex')

  return {
    async encrypt(plaintext: Uint8Array) {
      const iv = randomBytes(IV_LENGTH)
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
      const authTag = cipher.getAuthTag()
      // Store authTag appended to ciphertext
      const ciphertext = Buffer.concat([encrypted, authTag])
      return { ciphertext: new Uint8Array(ciphertext), iv: new Uint8Array(iv) }
    },

    async decrypt(ciphertext: Uint8Array, iv: Uint8Array) {
      const buf = Buffer.from(ciphertext)
      const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH)
      const encrypted = buf.subarray(0, buf.length - AUTH_TAG_LENGTH)
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv), { authTagLength: AUTH_TAG_LENGTH })
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
      return new Uint8Array(decrypted)
    }
  }
}
