import React, { useState, useEffect } from 'react'
import { useAuthBridge } from './hooks/useAuthBridge.js'
import { useGoogleAuth } from './hooks/useGoogleAuth.js'
import { useMagicLink } from './hooks/useMagicLink.js'
import { useBRC100Auth } from './hooks/useBRC100Auth.js'

interface AuthBridgeLoginProps {
  /** Optional CSS class name for the container */
  className?: string
  /** Optional inline styles for the container */
  style?: React.CSSProperties
}

/**
 * Drop-in login component that shows configured authentication options.
 *
 * Renders Google, email, and BRC-100 wallet login buttons based on the
 * providers configured in <AuthBridgeProvider>.
 *
 * @example
 * ```tsx
 * function App() {
 *   const { session } = useAuthBridge()
 *   if (!session) return <AuthBridgeLogin />
 *   return <Dashboard />
 * }
 * ```
 */
export function AuthBridgeLogin({ className, style }: AuthBridgeLoginProps) {
  const { providers, isLoading, error } = useAuthBridge()
  const { initiateGoogleAuth, handleGoogleCallback } = useGoogleAuth()
  const { sendMagicLink, cancel: cancelMagicLink } = useMagicLink()
  const { connectWallet } = useBRC100Auth()

  const [emailInput, setEmailInput] = useState('')
  const [emailSent, setEmailSent] = useState(false)

  // Handle Google OAuth callback on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (code) {
      handleGoogleCallback(code)
    }
  }, [handleGoogleCallback])

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!emailInput.trim()) return
    const sent = await sendMagicLink(emailInput.trim())
    if (sent) setEmailSent(true)
  }

  const handleCancelEmail = () => {
    cancelMagicLink()
    setEmailSent(false)
  }

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxWidth: '360px',
    margin: '0 auto',
    padding: '24px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    ...style
  }

  const buttonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px 16px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 0.15s',
    backgroundColor: '#fff',
    color: '#333'
  }

  const inputStyle: React.CSSProperties = {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box'
  }

  if (isLoading) {
    return (
      <div style={containerStyle} className={className}>
        <p style={{ textAlign: 'center', color: '#666' }}>Loading...</p>
      </div>
    )
  }

  return (
    <div style={containerStyle} className={className}>
      {error && (
        <div style={{
          padding: '10px 14px',
          backgroundColor: '#fef2f2',
          color: '#dc2626',
          borderRadius: '8px',
          fontSize: '13px'
        }}>
          {error}
        </div>
      )}

      {/* Google */}
      {providers.includes('google') && (
        <button
          onClick={initiateGoogleAuth}
          style={{ ...buttonStyle }}
          onMouseOver={e => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
          onMouseOut={e => (e.currentTarget.style.backgroundColor = '#fff')}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Sign in with Google
        </button>
      )}

      {/* Email magic link */}
      {providers.includes('email') && !emailSent && (
        <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#999',
            fontSize: '12px',
            margin: providers.includes('google') ? '4px 0' : '0'
          }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#eee' }} />
            or
            <div style={{ flex: 1, height: '1px', backgroundColor: '#eee' }} />
          </div>
          <input
            type="email"
            placeholder="Enter your email"
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            style={inputStyle}
            required
          />
          <button type="submit" style={{
            ...buttonStyle,
            backgroundColor: '#2563eb',
            color: '#fff',
            border: 'none'
          }}>
            Send magic link
          </button>
        </form>
      )}

      {/* Email sent — polling */}
      {providers.includes('email') && emailSent && (
        <div style={{
          padding: '16px',
          backgroundColor: '#f0f9ff',
          borderRadius: '8px',
          textAlign: 'center'
        }}>
          <p style={{ margin: '0 0 8px', fontWeight: 500 }}>Check your email</p>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#666' }}>
            We sent a login link to <strong>{emailInput}</strong>
          </p>
          <button
            onClick={handleCancelEmail}
            style={{ ...buttonStyle, fontSize: '13px', padding: '8px 12px' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* BRC-100 Wallet */}
      {providers.includes('brc100') && (
        <>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#999',
            fontSize: '12px',
            margin: '4px 0'
          }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#eee' }} />
            or
            <div style={{ flex: 1, height: '1px', backgroundColor: '#eee' }} />
          </div>
          <button
            onClick={connectWallet}
            style={{
              ...buttonStyle,
              backgroundColor: '#1a1a2e',
              color: '#fff',
              border: 'none'
            }}
          >
            Connect BRC-100 Wallet
          </button>
        </>
      )}
    </div>
  )
}
