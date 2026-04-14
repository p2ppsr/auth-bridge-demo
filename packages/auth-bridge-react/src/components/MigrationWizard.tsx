import React, { useState, useCallback } from 'react'
import { useAuthBridge } from '../hooks/useAuthBridge.js'

interface MigrationWizardProps {
  /** Optional CSS class name */
  className?: string
  /** Callback when migration completes */
  onComplete?: () => void
}

type MigrationStep = 'intro' | 'connecting' | 'migrating' | 'complete' | 'error'

/**
 * UI wizard for migrating from a managed wallet to a self-sovereign BRC-100 wallet.
 *
 * Shows a step-by-step flow:
 * 1. Explains what migration means
 * 2. Connects to the user's BRC-100 wallet to get their target identity key
 * 3. Initiates and completes the migration via the server
 * 4. Confirms completion
 *
 * @example
 * ```tsx
 * {session.isManagedWallet && <MigrationWizard onComplete={() => logout()} />}
 * ```
 */
export function MigrationWizard({ className, onComplete }: MigrationWizardProps) {
  const { serverUrl, session, logout } = useAuthBridge()
  const [step, setStep] = useState<MigrationStep>('intro')
  const [error, setError] = useState<string | null>(null)
  const [targetKey, setTargetKey] = useState('')

  const startMigration = useCallback(async () => {
    if (!targetKey || targetKey.length !== 66) {
      setError('Please enter a valid 66-character compressed public key hex')
      return
    }

    setStep('migrating')
    setError(null)

    try {
      // Step 1: Initiate migration
      const initiateRes = await fetch(`${serverUrl}/migrate/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ targetIdentityKey: targetKey })
      })

      if (!initiateRes.ok) {
        const data = await initiateRes.json()
        throw new Error(data.error || 'Failed to initiate migration')
      }

      const { migrationId } = await initiateRes.json()

      // Step 2: Complete migration
      const completeRes = await fetch(`${serverUrl}/migrate/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ migrationId })
      })

      if (!completeRes.ok) {
        const data = await completeRes.json()
        throw new Error(data.error || 'Failed to complete migration')
      }

      setStep('complete')
    } catch (err: any) {
      setError(err.message || 'Migration failed')
      setStep('error')
    }
  }, [serverUrl, targetKey])

  const containerStyle: React.CSSProperties = {
    maxWidth: '480px',
    margin: '0 auto',
    padding: '24px',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  }

  const buttonStyle: React.CSSProperties = {
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none'
  }

  if (!session?.isManagedWallet) return null

  return (
    <div style={containerStyle} className={className}>
      {step === 'intro' && (
        <>
          <h3 style={{ margin: '0 0 12px' }}>Migrate to Self-Sovereign Wallet</h3>
          <p style={{ color: '#555', fontSize: '14px', lineHeight: 1.5 }}>
            Take full ownership of your identity and data. After migration:
          </p>
          <ul style={{ color: '#555', fontSize: '14px', lineHeight: 1.8, paddingLeft: '20px' }}>
            <li>Your private keys will be under your sole control</li>
            <li>The server will no longer hold any key material</li>
            <li>You'll log in with your BRC-100 wallet instead of Google/email</li>
            <li>All your on-chain data remains accessible</li>
          </ul>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
            <label style={{ fontSize: '13px', color: '#666' }}>
              Your BRC-100 wallet identity key (compressed public key hex):
            </label>
            <input
              type="text"
              value={targetKey}
              onChange={e => setTargetKey(e.target.value)}
              placeholder="02 or 03..."
              style={{
                padding: '10px 12px',
                border: '1px solid #ddd',
                borderRadius: '8px',
                fontSize: '13px',
                fontFamily: 'monospace'
              }}
            />
            <button
              onClick={startMigration}
              style={{ ...buttonStyle, backgroundColor: '#2563eb', color: '#fff' }}
            >
              Start Migration
            </button>
          </div>
        </>
      )}

      {step === 'migrating' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '16px', fontWeight: 500 }}>Migrating...</p>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Transferring assets and clearing server keys. Do not close this page.
          </p>
        </div>
      )}

      {step === 'complete' && (
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ color: '#16a34a', margin: '0 0 12px' }}>Migration Complete</h3>
          <p style={{ color: '#555', fontSize: '14px', lineHeight: 1.5 }}>
            Your identity and assets are now under your sole control.
            You can now log in using your BRC-100 wallet.
          </p>
          <button
            onClick={() => {
              onComplete?.()
              logout()
            }}
            style={{ ...buttonStyle, backgroundColor: '#2563eb', color: '#fff', marginTop: '16px' }}
          >
            Done
          </button>
        </div>
      )}

      {step === 'error' && (
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ color: '#dc2626', margin: '0 0 12px' }}>Migration Failed</h3>
          <p style={{ color: '#555', fontSize: '14px' }}>{error}</p>
          <button
            onClick={() => setStep('intro')}
            style={{ ...buttonStyle, backgroundColor: '#f5f5f5', color: '#333', marginTop: '16px', border: '1px solid #ddd' }}
          >
            Try Again
          </button>
        </div>
      )}

      {error && step !== 'error' && (
        <p style={{ color: '#dc2626', fontSize: '13px', marginTop: '8px' }}>{error}</p>
      )}
    </div>
  )
}
