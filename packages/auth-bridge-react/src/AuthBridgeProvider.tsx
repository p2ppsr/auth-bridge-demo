import React, { createContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { AuthBridgeConfig, AuthBridgeContextValue, AuthBridgeSession } from './types.js'

export const AuthBridgeContext = createContext<AuthBridgeContextValue | null>(null)

const SESSION_STORAGE_KEY = 'auth_bridge_session'

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

  // Restore session on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const res = await fetch(`${serverUrl}/session`, {
          credentials: 'include'
        })
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
      } catch {
        // No session — that's fine
      } finally {
        setLoading(false)
      }
    }
    restore()
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
