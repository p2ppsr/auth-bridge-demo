export interface AuthBridgeSession {
  identityKey: string
  authMethod: 'google' | 'email' | 'brc100'
  isManagedWallet: boolean
  displayName?: string
  email?: string
  isNewUser?: boolean
}

export interface AuthBridgeConfig {
  /** URL of the auth-bridge-express backend (e.g. '/auth' or 'https://api.example.com/auth') */
  serverUrl: string
  /** Google OAuth client ID. Required if 'google' is in providers. */
  googleClientId?: string
  /** Which auth providers to show (default: all configured) */
  providers?: ('google' | 'email' | 'brc100')[]
}

export interface AuthBridgeContextValue {
  /** Current session, or null if not authenticated */
  session: AuthBridgeSession | null
  /** Whether an auth operation is in progress */
  isLoading: boolean
  /** Last error message */
  error: string | null
  /** Log out and clear session */
  logout: () => Promise<void>
  /** Server URL for the auth bridge backend */
  serverUrl: string
  /** Google client ID */
  googleClientId?: string
  /** Enabled providers */
  providers: ('google' | 'email' | 'brc100')[]
  /** Set session (used by auth hooks) */
  setSession: (session: AuthBridgeSession | null) => void
  /** Set loading state (used by auth hooks) */
  setLoading: (loading: boolean) => void
  /** Set error (used by auth hooks) */
  setError: (error: string | null) => void
}
