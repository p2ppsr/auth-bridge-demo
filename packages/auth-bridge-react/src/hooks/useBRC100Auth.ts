import { useCallback } from 'react'
import { useAuthBridge } from './useAuthBridge.js'

/**
 * Hook for native BRC-100 wallet authentication.
 *
 * Connects to the user's BRC-100 wallet (e.g. MetaNet Client) via WalletClient
 * auto-discovery, then uses AuthFetch to perform a mutual auth handshake with
 * the backend. The backend issues a session for the wallet's identity key.
 *
 * @example
 * ```tsx
 * const { connectWallet } = useBRC100Auth()
 * <button onClick={connectWallet}>Connect BRC-100 Wallet</button>
 * ```
 */
export function useBRC100Auth() {
  const { serverUrl, setSession, setLoading, setError } = useAuthBridge()

  const connectWallet = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Dynamic import so @bsv/sdk is only loaded when BRC-100 auth is attempted
      const { WalletClient, AuthFetch } = await import('@bsv/sdk')

      // Auto-discover a running BRC-100 wallet (MetaNet Client, desktop wallet, etc.)
      const wallet = new WalletClient()
      try {
        await wallet.connectToSubstrate()
      } catch {
        setError('No BRC-100 wallet found. Make sure MetaNet Client or a compatible wallet is running.')
        setLoading(false)
        return
      }

      // Verify the wallet is actually connected
      try {
        await wallet.getVersion({})
      } catch {
        setError('Could not communicate with BRC-100 wallet. Is it running?')
        setLoading(false)
        return
      }

      // Use AuthFetch to perform mutual auth handshake and hit the session endpoint
      const authFetch = new AuthFetch(wallet)
      const baseUrl = window.location.origin
      const res = await authFetch.fetch(`${baseUrl}${serverUrl}/brc100/session`, {
        method: 'POST'
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'BRC-100 authentication failed')
        setLoading(false)
        return
      }

      const data = await res.json()

      // AuthFetch doesn't propagate Set-Cookie to the browser, so we
      // re-establish the session cookie via a regular fetch with the JWT
      if (data.token) {
        await fetch(`${serverUrl}/session`, {
          headers: { 'Authorization': `Bearer ${data.token}` },
          credentials: 'include'
        })
      }

      setSession(data.session)
    } catch (err: any) {
      setError(err.message || 'Failed to connect BRC-100 wallet')
    } finally {
      setLoading(false)
    }
  }, [serverUrl, setSession, setLoading, setError])

  return { connectWallet }
}
