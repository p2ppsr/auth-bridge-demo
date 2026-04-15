import { useContext } from 'react'
import { AuthBridgeContext } from '../AuthBridgeProvider.js'
import type { AuthBridgeContextValue } from '../types.js'

/**
 * Hook to access the Auth Bridge context.
 * Returns session state, logout function, and auth status.
 *
 * @example
 * ```tsx
 * const { session, logout, isLoading } = useAuthBridge()
 * if (isLoading) return <Spinner />
 * if (!session) return <AuthBridgeLogin />
 * return <p>Hello {session.identityKey}</p>
 * ```
 */
export function useAuthBridge(): AuthBridgeContextValue {
  const ctx = useContext(AuthBridgeContext)
  if (!ctx) {
    throw new Error('useAuthBridge must be used within an <AuthBridgeProvider>')
  }
  return ctx
}
