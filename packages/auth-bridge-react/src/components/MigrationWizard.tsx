import React, { useState, useEffect, useCallback } from 'react'
import { useAuthBridge } from '../hooks/useAuthBridge.js'

interface MigrationWizardProps {
  className?: string
  onComplete?: () => void
}

type Step = 'connecting' | 'review' | 'migrating' | 'complete' | 'error'

interface Plan {
  baskets: Array<{ basket: string; count: number; totalSats: number }>
  totalSats: number
}

interface Progress {
  phase: string
  detail?: string
  txid?: string
}

/**
 * Migration wizard: moves data from the managed (web2-style) wallet
 * into the user's own BRC-100 wallet with visible step-by-step progress.
 */
export function MigrationWizard({ className, onComplete }: MigrationWizardProps) {
  const { serverUrl, session, logout } = useAuthBridge()
  const [step, setStep] = useState<Step>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [targetKey, setTargetKey] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [progress, setProgress] = useState<Progress[]>([])
  const [fundsTxid, setFundsTxid] = useState<string | null>(null)
  const [todosMoved, setTodosMoved] = useState(0)

  const pushProgress = useCallback((p: Progress) => setProgress(prev => [...prev, p]), [])

  // Auto-connect & load plan on mount
  useEffect(() => {
    const run = async () => {
      try {
        const { WalletClient } = await import('@bsv/sdk')
        const wallet = new WalletClient()
        await wallet.connectToSubstrate()
        const info = await wallet.getPublicKey({ identityKey: true })
        setTargetKey(info.publicKey)

        const res = await fetch(`${serverUrl}/migrate/plan`, { credentials: 'include' })
        if (!res.ok) throw new Error('Failed to fetch migration plan')
        setPlan(await res.json())
        setStep('review')
      } catch (e: any) {
        setError(e.message || 'Could not connect to your wallet. Is MetaNet Client running?')
        setStep('error')
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runMigration = useCallback(async () => {
    if (!targetKey) return
    setStep('migrating')
    setProgress([])
    setError(null)

    try {
      const { WalletClient } = await import('@bsv/sdk')
      const targetWallet = new WalletClient()
      await targetWallet.connectToSubstrate()

      // Transfer funds
      pushProgress({ phase: 'Transferring balance', detail: 'Preparing transaction...' })
      const fundsRes = await fetch(`${serverUrl}/migrate/transfer-funds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ targetIdentityKey: targetKey })
      })
      if (!fundsRes.ok) throw new Error((await fundsRes.json()).error || 'Failed to transfer balance')
      const fundsData = await fundsRes.json()

      if (!fundsData.transferred && fundsData.satoshis) {
        pushProgress({ phase: 'Transferring balance', detail: `Receiving ${fundsData.satoshis} sats on your wallet...`, txid: fundsData.txid })
        await (targetWallet as any).internalizeAction({
          tx: fundsData.tx,
          outputs: [{
            outputIndex: fundsData.vout,
            protocol: 'wallet payment',
            paymentRemittance: {
              derivationPrefix: fundsData.derivationPrefix,
              derivationSuffix: fundsData.derivationSuffix,
              senderIdentityKey: fundsData.senderIdentityKey
            }
          }],
          description: 'Account migration'
        })
        setFundsTxid(fundsData.txid)
        pushProgress({ phase: 'Transferring balance', detail: `Done — ${fundsData.satoshis} sats now in your wallet`, txid: fundsData.txid })
      } else {
        pushProgress({ phase: 'Transferring balance', detail: 'Nothing to transfer' })
      }

      // Migrate todos (re-encrypt under target wallet)
      pushProgress({ phase: 'Transferring items', detail: 'Reading items from server...' })
      const todosRes = await fetch(`${serverUrl}/migrate/todos`, { credentials: 'include' })
      if (!todosRes.ok) throw new Error('Failed to read items')
      const { todos } = await todosRes.json() as { todos: Array<{ task: string; sats: number }> }

      if (todos.length === 0) {
        pushProgress({ phase: 'Transferring items', detail: 'No items to transfer' })
      } else {
        const { PushDrop, Utils } = await import('@bsv/sdk')
        const protocolID = [0, 'todo list'] as any
        const keyID = '1'
        const TODO_PROTO_ADDR = '1ToDoDtKreEzbHYKFjmoBuduFmSXXUGZG'

        for (let i = 0; i < todos.length; i++) {
          const t = todos[i]
          pushProgress({ phase: 'Transferring items', detail: `${i + 1} of ${todos.length}: ${t.task}` })
          const enc = await (targetWallet as any).encrypt({
            plaintext: Utils.toArray(t.task, 'utf8'),
            protocolID, keyID
          })
          const pushdrop = new PushDrop(targetWallet as any)
          const lock = await pushdrop.lock(
            [Utils.toArray(TODO_PROTO_ADDR, 'utf8'), enc.ciphertext],
            protocolID, keyID, 'self'
          )
          await (targetWallet as any).createAction({
            outputs: [{
              lockingScript: lock.toHex(),
              satoshis: 1,
              basket: 'todo tokens',
              outputDescription: 'Migrated item'
            }],
            options: { randomizeOutputs: false, acceptDelayedBroadcast: true },
            description: `Migrated: ${t.task.substring(0, 40)}`
          })
          setTodosMoved(i + 1)
        }
        pushProgress({ phase: 'Transferring items', detail: `Done — ${todos.length} items secured by your wallet` })
      }

      // Finalize
      pushProgress({ phase: 'Securing account', detail: 'Clearing server-side keys...' })
      const finRes = await fetch(`${serverUrl}/migrate/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ targetIdentityKey: targetKey })
      })
      if (!finRes.ok) throw new Error('Failed to finalize')
      pushProgress({ phase: 'Securing account', detail: 'Done — server holds no keys for your account' })

      setStep('complete')
    } catch (e: any) {
      setError(e.message || 'Migration failed')
      setStep('error')
    }
  }, [serverUrl, targetKey, pushProgress])

  if (!session?.isManagedWallet) return null

  return (
    <div className={className} style={{ fontFamily: 'system-ui, sans-serif' }}>
      {step === 'connecting' && (
        <Card>
          <Spinner />
          <p style={{ marginTop: 12, color: '#334155' }}>Looking for your wallet…</p>
          <p style={{ marginTop: 4, fontSize: 13, color: '#94a3b8' }}>
            Start MetaNet Client if it isn't running.
          </p>
        </Card>
      )}

      {step === 'review' && plan && targetKey && (
        <>
          <Card>
            <Label>Your wallet</Label>
            <Mono>{targetKey.substring(0, 20)}…{targetKey.substring(targetKey.length - 12)}</Mono>
          </Card>

          <Card>
            <Label>What will move to your wallet</Label>
            {plan.baskets.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 14, margin: '10px 0 0' }}>Nothing to transfer yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
                {plan.baskets.map(b => (
                  <li key={b.basket} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span>{b.basket === 'default' ? 'Account balance' : b.basket === 'todo tokens' ? 'Your items' : b.basket}</span>
                    <span style={{ color: '#64748b' }}>
                      {b.basket === 'default' ? `${b.totalSats} sats` : `${b.count} items`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 16 }}>
            After this step, your wallet holds the keys — the server can no longer read or modify your data.
            You'll sign in with your wallet from now on.
          </p>

          <ButtonRow>
            <Button onClick={() => onComplete?.()}>Cancel</Button>
            <Button onClick={runMigration} primary>Move to my wallet</Button>
          </ButtonRow>
        </>
      )}

      {step === 'migrating' && (
        <>
          <Card>
            <Label>Working…</Label>
            <div style={{ marginTop: 12 }}>
              {progress.map((p, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: i === progress.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#334155' }}>{p.phase}</div>
                  {p.detail && <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{p.detail}</div>}
                  {p.txid && (
                    <a href={`https://whatsonchain.com/tx/${p.txid}`} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, fontFamily: 'monospace', color: '#2563eb', marginTop: 4, display: 'inline-block', textDecoration: 'none' }}>
                      View on chain ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
            <Spinner style={{ marginTop: 16 }} />
          </Card>
        </>
      )}

      {step === 'complete' && (
        <>
          <Card style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <CheckCircle />
              <div>
                <div style={{ color: '#166534', fontWeight: 600, fontSize: 16 }}>You're in control</div>
                <div style={{ color: '#166534', fontSize: 13, marginTop: 2 }}>
                  Your data is now under the sole custody of your wallet.
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <Label>Summary</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 16px', marginTop: 10, fontSize: 13 }}>
              <span style={{ color: '#94a3b8' }}>Wallet</span>
              <Mono>{targetKey?.substring(0, 16)}…</Mono>
              {fundsTxid && (<>
                <span style={{ color: '#94a3b8' }}>Balance tx</span>
                <a href={`https://whatsonchain.com/tx/${fundsTxid}`} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#2563eb', fontFamily: 'monospace', fontSize: 12 }}>
                  {fundsTxid.substring(0, 20)}…
                </a>
              </>)}
              {todosMoved > 0 && (<>
                <span style={{ color: '#94a3b8' }}>Items moved</span>
                <span>{todosMoved}</span>
              </>)}
            </div>
          </Card>

          <ButtonRow>
            <Button primary onClick={() => { onComplete?.(); logout() }}>
              Sign in with my wallet
            </Button>
          </ButtonRow>
        </>
      )}

      {step === 'error' && (
        <>
          <Card style={{ background: '#fef2f2', border: '1px solid #fca5a5' }}>
            <div style={{ color: '#991b1b', fontWeight: 600, fontSize: 14 }}>Something went wrong</div>
            <div style={{ color: '#991b1b', fontSize: 13, marginTop: 4 }}>{error}</div>
          </Card>
          <ButtonRow>
            <Button onClick={() => onComplete?.()}>Close</Button>
            <Button primary onClick={() => window.location.reload()}>Try again</Button>
          </ButtonRow>
        </>
      )}
    </div>
  )
}

// ── Style helpers ──────────────────────────────────────────────
const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
    padding: 16, marginBottom: 12, ...style
  }}>{children}</div>
)
const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 600 }}>{children}</div>
)
const Mono: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#334155', marginTop: 4, wordBreak: 'break-all' }}>{children}</div>
)
const ButtonRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>{children}</div>
)
const Button: React.FC<{ children: React.ReactNode; onClick: () => void; primary?: boolean }> = ({ children, onClick, primary }) => (
  <button onClick={onClick} style={{
    padding: '10px 18px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
    border: primary ? 'none' : '1px solid #cbd5e1',
    background: primary ? '#2563eb' : '#fff',
    color: primary ? '#fff' : '#334155'
  }}>{children}</button>
)
const Spinner: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <div style={{
    width: 24, height: 24, borderRadius: '50%', border: '3px solid #e2e8f0',
    borderTopColor: '#2563eb', animation: 'ab-spin 0.8s linear infinite', ...style
  }}>
    <style>{`@keyframes ab-spin { to { transform: rotate(360deg); } }`}</style>
  </div>
)
const CheckCircle: React.FC = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="9 12 12 15 16 10" />
  </svg>
)
