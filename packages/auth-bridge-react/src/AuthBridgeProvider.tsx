import React, { createContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { AuthBridgeConfig, AuthBridgeContextValue, AuthBridgeSession } from './types.js'

export const AuthBridgeContext = createContext<AuthBridgeContextValue | null>(null)

const SESSION_STORAGE_KEY = 'auth_bridge_session'
const GOOGLE_VERIFIER_KEY = 'auth_bridge_google_cv'

interface AuthBridgeProviderProps extends AuthBridgeConfig {
  children: ReactNode
}

export function AuthBridgeProvider({
  serverUrl,
  googleClientId,
  providers = ['google', 'email', 'brc100'],
  children
}: AuthBridgeProviderProps) {
  const [session, setSession] = useState<AuthBridgeSession | null>(null)
  const [isLoading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const callbackHandledRef = useRef(false)

  useEffect(() => {
    const init = async () => {
      try {
        // 1. If we're returning from a Google OAuth redirect, finish that first.
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        if (code && !callbackHandledRef.current) {
          callbackHandledRef.current = true
          const codeVerifier = sessionStorage.getItem(GOOGLE_VERIFIER_KEY)
          if (codeVerifier) {
            sessionStorage.removeItem(GOOGLE_VERIFIER_KEY)
            const redirectUri = window.location.origin
            try {
              const res = await fetch(`${serverUrl}/google/callback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ code, codeVerifier, redirectUri })
              })
              if (res.ok) {
                const data = await res.json()
                if (data.session) setSession(data.session)
              } else {
                const data = await res.json().catch(() => ({}))
                setError(data.error || 'Google authentication failed')
              }
            } catch (err: any) {
              setError(err?.message || 'Failed to complete Google authentication')
            }
            // Clean URL params so a refresh doesn't retry
            const url = new URL(window.location.href)
            url.searchParams.delete('code')
            url.searchParams.delete('scope')
            url.searchParams.delete('authuser')
            url.searchParams.delete('prompt')
            url.searchParams.delete('state')
            window.history.replaceState({}, '', url.toString())
          }
        }

        // 2. If we didn't just finish a login, try restoring an existing session.
        if (!callbackHandledRef.current) {
          const res = await fetch(`${serverUrl}/session`, { credentials: 'include' })
          if (res.ok) {
            const data = await res.json()
            if (data.identityKey) {
              setSession({
                identityKey: data.identityKey,
                authMethod: data.authMethod,
                isManagedWallet: data.isManagedWallet,
                email: data.email,
                displayName: data.displayName
              })
            }
          }
        }
      } catch {
        // No session — that's fine
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [serverUrl])

  const logout = useCallback(async () => {
    try {
      await fetch(`${serverUrl}/logout`, {
        method: 'POST',
        credentials: 'include'
      })
    } catch {
      // Best effort
    }
    setSession(null)
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  }, [serverUrl])

  const value: AuthBridgeContextValue = {
    session,
    isLoading,
    error,
    logout,
    serverUrl,
    googleClientId,
    providers,
    setSession,
    setLoading,
    setError
  }

  return (
    <AuthBridgeContext.Provider value={value}>
      {children}
    </AuthBridgeContext.Provider>
  )
}
