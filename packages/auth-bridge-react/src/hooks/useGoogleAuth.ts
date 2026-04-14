import { useCallback } from 'react'
import { useAuthBridge } from './useAuthBridge.js'

/**
 * Generates a random string for PKCE code verifier.
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Generates a PKCE code challenge from a code verifier.
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const VERIFIER_KEY = 'auth_bridge_google_cv'

/**
 * Hook for Google OAuth PKCE authentication.
 *
 * @example
 * ```tsx
 * const { initiateGoogleAuth, handleGoogleCallback } = useGoogleAuth()
 * <button onClick={initiateGoogleAuth}>Sign in with Google</button>
 * ```
 */
export function useGoogleAuth() {
  const { serverUrl, googleClientId, setSession, setLoading, setError } = useAuthBridge()

  /**
   * Redirect the user to Google's OAuth consent screen.
   */
  const initiateGoogleAuth = useCallback(async () => {
    if (!googleClientId) {
      setError('Google client ID not configured')
      return
    }

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)

    // Store verifier for the callback
    sessionStorage.setItem(VERIFIER_KEY, codeVerifier)

    const redirectUri = window.location.origin
    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'select_account'
    })

    window.location.href = `${GOOGLE_AUTH_URL}?${params}`
  }, [googleClientId, setError])

  /**
   * Handle the OAuth callback by exchanging the authorization code for a session.
   * Call this when the page loads and a `code` query parameter is present.
   */
  const handleGoogleCallback = useCallback(async (code: string) => {
    setLoading(true)
    setError(null)

    try {
      const codeVerifier = sessionStorage.getItem(VERIFIER_KEY)
      if (!codeVerifier) {
        setError('Missing PKCE code verifier. Please try signing in again.')
        return
      }
      sessionStorage.removeItem(VERIFIER_KEY)

      const redirectUri = window.location.origin

      const res = await fetch(`${serverUrl}/google/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code, codeVerifier, redirectUri })
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Google authentication failed')
        return
      }

      const data = await res.json()
      setSession(data.session)

      // Clean up URL
      const url = new URL(window.location.href)
      url.searchParams.delete('code')
      url.searchParams.delete('scope')
      url.searchParams.delete('authuser')
      url.searchParams.delete('prompt')
      window.history.replaceState({}, '', url.toString())
    } catch (err) {
      setError('Failed to complete Google authentication')
    } finally {
      setLoading(false)
    }
  }, [serverUrl, setSession, setLoading, setError])

  return { initiateGoogleAuth, handleGoogleCallback }
}
