import { useCallback, useRef } from 'react'
import { useAuthBridge } from './useAuthBridge.js'

/**
 * Hook for email magic link authentication.
 *
 * Flow:
 * 1. Call `sendMagicLink(email)` — server sends an email with a verification link
 * 2. User clicks the link in their email (opens in a new tab, verifies the token)
 * 3. Meanwhile, this hook polls the server until verification is confirmed
 * 4. Once verified, the session is established automatically
 *
 * @example
 * ```tsx
 * const { sendMagicLink, emailSent, cancel } = useMagicLink()
 * if (!emailSent) return <input onSubmit={e => sendMagicLink(email)} />
 * return <p>Check your email! <button onClick={cancel}>Cancel</button></p>
 * ```
 */
export function useMagicLink() {
  const { serverUrl, setSession, setLoading, setError } = useAuthBridge()
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollTokenRef = useRef<string | null>(null)

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    pollTokenRef.current = null
  }, [])

  const sendMagicLink = useCallback(async (email: string) => {
    setLoading(true)
    setError(null)
    stopPolling()

    try {
      const res = await fetch(`${serverUrl}/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to send magic link')
        setLoading(false)
        return false
      }

      const data = await res.json()
      pollTokenRef.current = data.pollToken

      // Start polling for verification
      pollIntervalRef.current = setInterval(async () => {
        if (!pollTokenRef.current) {
          stopPolling()
          return
        }

        try {
          const pollRes = await fetch(`${serverUrl}/email/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ pollToken: pollTokenRef.current })
          })

          if (pollRes.ok) {
            const pollData = await pollRes.json()
            if (pollData.verified && pollData.session) {
              stopPolling()
              setSession(pollData.session)
              setLoading(false)
            }
          }
        } catch {
          // Polling failure is non-fatal — keep trying
        }
      }, 2000)

      setLoading(false)
      return true
    } catch (err) {
      setError('Failed to send magic link')
      setLoading(false)
      return false
    }
  }, [serverUrl, setSession, setLoading, setError, stopPolling])

  const cancel = useCallback(() => {
    stopPolling()
    setLoading(false)
    setError(null)
  }, [stopPolling, setLoading, setError])

  return {
    sendMagicLink,
    cancel,
    emailSent: pollTokenRef.current !== null
  }
}
