import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  AuthBridgeProvider,
  AuthBridgeLogin,
  MigrationWizard,
  useAuthBridge,
  ProxyWalletClient
} from '@bsv/auth-bridge-react'
import { PushDrop, Utils, Transaction, LockingScript, type WalletOutput } from '@bsv/sdk'

const GOOGLE_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID

const PROTOCOL_ID: [number, string] = [0, 'todo list']
const KEY_ID = '1'
const TODO_PROTO_ADDR = '1ToDoDtKreEzbHYKFjmoBuduFmSXXUGZG'

interface Task {
  task: string
  sats: number
  outpoint: string
  lockingScript: string
  beef: number[] | undefined
}

// ─── App ────────────────────────────────────────────────────────────
export function App() {
  // TODO: re-enable 'email' once SendGrid is integrated for magic-link delivery
  const providers: ('google' | 'email' | 'brc100')[] = ['brc100']
  if (GOOGLE_CLIENT_ID) providers.unshift('google')

  return (
    <AuthBridgeProvider serverUrl="/auth" googleClientId={GOOGLE_CLIENT_ID} providers={providers}>
      <Root />
    </AuthBridgeProvider>
  )
}

// ─── Root: landing vs. app ──────────────────────────────────────────
function Root() {
  const { session, isLoading } = useAuthBridge()
  if (isLoading) return <FullScreenLoader />
  return session ? <AppShell /> : <Landing />
}

function FullScreenLoader() {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#fafafa'
    }}>
      <Spinner />
    </div>
  )
}

// ─── Landing Page (signed out) ──────────────────────────────────────
function Landing() {
  const [authOpen, setAuthOpen] = useState(false)

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa' }}>
      <TopBar>
        <Logo />
        <button onClick={() => setAuthOpen(true)} style={{
          padding: '8px 18px', borderRadius: 8, border: 'none', background: '#111',
          color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer'
        }}>
          Sign in
        </button>
      </TopBar>

      <main style={{
        maxWidth: 720, margin: '0 auto', padding: '80px 24px 40px',
        textAlign: 'center'
      }}>
        <h1 style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 16px', color: '#111' }}>
          Get things done.
        </h1>
        <p style={{ fontSize: 19, color: '#555', margin: '0 0 32px', lineHeight: 1.5 }}>
          A beautifully simple todo app — with a secret. Your data is cryptographically yours, and you can take it with you whenever you want.
        </p>
        <button onClick={() => setAuthOpen(true)} style={{
          padding: '14px 28px', borderRadius: 10, border: 'none', background: '#111',
          color: '#fff', fontSize: 16, fontWeight: 500, cursor: 'pointer'
        }}>
          Get started — it's free
        </button>

        <div style={{ marginTop: 80, display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', textAlign: 'left' }}>
          <Feature title="Simple" body="Create tasks. Check them off. That's it." />
          <Feature title="Private" body="Every task is encrypted before it ever leaves your device." />
          <Feature title="Portable" body="Take your data with you — you own it, always." />
        </div>
      </main>

      {authOpen && (
        <Modal onClose={() => setAuthOpen(false)} title="Sign in to Tasks">
          <AuthBridgeLogin />
        </Modal>
      )}
    </div>
  )
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px', color: '#111' }}>{title}</h3>
      <p style={{ fontSize: 14, color: '#666', margin: 0, lineHeight: 1.5 }}>{body}</p>
    </div>
  )
}

// ─── App Shell (signed in) ──────────────────────────────────────────
function AppShell() {
  const { session, logout, serverUrl } = useAuthBridge()
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [migrateOpen, setMigrateOpen] = useState(false)

  if (!session) return null

  const displayName = session.displayName || session.email || 'Account'

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa' }}>
      <TopBar>
        <Logo />
        <div style={{ position: 'relative' }}>
          <button onClick={() => setMenuOpen(!menuOpen)} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px 6px 6px', borderRadius: 20, border: '1px solid #e5e5e5',
            background: '#fff', cursor: 'pointer', fontSize: 13, color: '#111'
          }}>
            <Avatar name={displayName} />
            <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>

          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
              <div style={{
                position: 'absolute', top: '110%', right: 0, minWidth: 220,
                background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.08)', padding: 4, zIndex: 20
              }}>
                <MenuHeader>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{displayName}</div>
                  {session.email && session.displayName && (
                    <div style={{ fontSize: 12, color: '#888' }}>{session.email}</div>
                  )}
                </MenuHeader>
                <MenuItem onClick={() => { setMenuOpen(false); setSettingsOpen(true) }}>Settings</MenuItem>
                <MenuItem onClick={() => { setMenuOpen(false); logout() }}>Sign out</MenuItem>
              </div>
            </>
          )}
        </div>
      </TopBar>

      <TodoPage />

      {settingsOpen && (
        <Modal onClose={() => setSettingsOpen(false)} title="Settings" wide>
          <SettingsPanel onUpgrade={() => { setSettingsOpen(false); setMigrateOpen(true) }} />
        </Modal>
      )}

      {migrateOpen && (
        <Modal onClose={() => setMigrateOpen(false)} title="Take ownership of your data" wide>
          <MigrationWizard onComplete={() => setMigrateOpen(false)} />
        </Modal>
      )}
    </div>
  )
}

// ─── Todo page ──────────────────────────────────────────────────────
function TodoPage() {
  const { session, serverUrl } = useAuthBridge()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getWallet = useCallback(async () => {
    if (session?.isManagedWallet) {
      return new ProxyWalletClient(serverUrl) as any
    } else {
      const { WalletClient } = await import('@bsv/sdk')
      const w = new WalletClient()
      await w.connectToSubstrate()
      return w
    }
  }, [session, serverUrl])

  const loadTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const wallet = await getWallet()
      const result = await wallet.listOutputs({
        basket: 'todo tokens',
        include: 'entire transactions',
        limit: 100
      })

      const decoded: Task[] = []
      for (const output of result.outputs as WalletOutput[]) {
        try {
          const txid = output.outpoint.split('.')[0]
          const tx = Transaction.fromBEEF(result.BEEF as number[], txid)
          if (!tx) continue
          const ls = tx.outputs[0].lockingScript
          const drop = PushDrop.decode(ls)
          const decResult = await wallet.decrypt({
            ciphertext: drop.fields[1], protocolID: PROTOCOL_ID, keyID: KEY_ID
          })
          decoded.push({
            task: Utils.toUTF8(decResult.plaintext),
            sats: output.satoshis ?? 0,
            outpoint: output.outpoint,
            lockingScript: ls.toHex(),
            beef: result.BEEF as number[]
          })
        } catch { /* skip */ }
      }
      setTasks(decoded.reverse())
    } catch (e: any) {
      if (!e.message?.includes('Wallet proxy only')) setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [getWallet])

  useEffect(() => { loadTasks() }, [loadTasks])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTask.trim()) return
    setCreating(true)
    setError(null)
    try {
      const wallet = await getWallet()
      const encrypted = await wallet.encrypt({
        plaintext: Utils.toArray(newTask, 'utf8'), protocolID: PROTOCOL_ID, keyID: KEY_ID
      })
      const pushdrop = new PushDrop(wallet)
      const lockScript = await pushdrop.lock(
        [Utils.toArray(TODO_PROTO_ADDR, 'utf8'), encrypted.ciphertext],
        PROTOCOL_ID, KEY_ID, 'self'
      )
      const result = await wallet.createAction({
        outputs: [{
          lockingScript: lockScript.toHex(), satoshis: 1, basket: 'todo tokens',
          outputDescription: 'Todo item'
        }],
        options: { randomizeOutputs: false, acceptDelayedBroadcast: true },
        description: `Create task: ${newTask}`
      })
      setTasks(prev => [{
        task: newTask, sats: 1,
        outpoint: `${result.txid}.0`,
        lockingScript: lockScript.toHex(),
        beef: result.tx
      }, ...prev])
      setNewTask('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const handleComplete = async (task: Task) => {
    setError(null)
    // Optimistic removal
    setTasks(prev => prev.filter(t => t.outpoint !== task.outpoint))
    try {
      const wallet = await getWallet()
      const { signableTransaction } = await wallet.createAction({
        description: `Complete task: ${task.task.substring(0, 64)}`,
        inputBEEF: task.beef,
        inputs: [{
          inputDescription: 'Complete task',
          outpoint: task.outpoint,
          unlockingScriptLength: 73
        }],
        options: { acceptDelayedBroadcast: true, randomizeOutputs: false }
      })
      if (!signableTransaction) throw new Error('Failed to create signable transaction')
      const partialTx = Transaction.fromBEEF(signableTransaction.tx)
      const unlocker = new PushDrop(wallet).unlock(
        PROTOCOL_ID, KEY_ID, 'self', 'all', false,
        task.sats, LockingScript.fromHex(task.lockingScript)
      )
      const unlockingScript = await unlocker.sign(partialTx, 0)
      await wallet.signAction({
        reference: signableTransaction.reference,
        spends: { 0: { unlockingScript: unlockingScript.toHex() } }
      })
    } catch (e: any) {
      setError(e.message)
      // Roll back
      setTasks(prev => [task, ...prev])
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px' }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 24px', color: '#111' }}>
        Today
      </h1>

      <form onSubmit={handleCreate} style={{
        display: 'flex', gap: 0, alignItems: 'center',
        background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10,
        padding: '4px 4px 4px 14px', marginBottom: 20
      }}>
        <span style={{
          width: 18, height: 18, borderRadius: '50%',
          border: '1.5px solid #cbd5e1', marginRight: 12, flexShrink: 0
        }} />
        <input
          type="text"
          placeholder="Add a task…"
          value={newTask}
          onChange={e => setNewTask(e.target.value)}
          disabled={creating}
          style={{
            flex: 1, padding: '10px 0', border: 'none', fontSize: 15,
            background: 'transparent', outline: 'none', color: '#111'
          }}
        />
        <button type="submit" disabled={creating || !newTask.trim()} style={{
          padding: '8px 16px', border: 'none', borderRadius: 8,
          background: newTask.trim() ? '#111' : '#e5e5e5',
          color: newTask.trim() ? '#fff' : '#999',
          fontSize: 13, fontWeight: 500, cursor: newTask.trim() ? 'pointer' : 'default'
        }}>
          {creating ? '…' : 'Add'}
        </button>
      </form>

      {error && (
        <div style={{
          padding: '10px 14px', background: '#fef2f2', color: '#991b1b',
          borderRadius: 8, fontSize: 13, marginBottom: 16
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <Spinner />
        </div>
      ) : tasks.length === 0 ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: '#999' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <p style={{ marginTop: 8, fontSize: 14 }}>No tasks yet. Add one above to get started.</p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {tasks.map(task => (
            <li key={task.outpoint} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', background: '#fff', border: '1px solid #f1f1f1',
              borderRadius: 10, marginBottom: 6
            }}>
              <button
                onClick={() => handleComplete(task)}
                title="Mark complete"
                aria-label="Complete task"
                style={{
                  width: 20, height: 20, borderRadius: '50%',
                  border: '1.5px solid #cbd5e1', background: 'none',
                  cursor: 'pointer', flexShrink: 0, padding: 0
                }}
              />
              <span style={{ flex: 1, fontSize: 15, color: '#111' }}>{task.task}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

// ─── Settings ───────────────────────────────────────────────────────
function SettingsPanel({ onUpgrade }: { onUpgrade: () => void }) {
  const { session } = useAuthBridge()
  if (!session) return null

  return (
    <div>
      <Section title="Account">
        <Row label="Signed in as">{session.email || session.displayName || '—'}</Row>
        <Row label="Method">{session.authMethod === 'brc100' ? 'Your wallet' : session.authMethod === 'google' ? 'Google' : 'Email'}</Row>
      </Section>

      {session.isManagedWallet ? (
        <Section title="Data ownership">
          <p style={{ fontSize: 14, color: '#555', lineHeight: 1.6, margin: '0 0 16px' }}>
            Your tasks are encrypted on-chain, but the encryption keys are currently held by our server so you can sign in with Google/email.
            You can take full ownership of your data by connecting your own wallet — we'll transfer everything over and delete the server keys.
          </p>
          <button onClick={onUpgrade} style={{
            padding: '10px 16px', borderRadius: 8, border: '1px solid #111',
            background: '#fff', color: '#111', fontSize: 14, fontWeight: 500, cursor: 'pointer'
          }}>
            Take ownership of my data
          </button>
        </Section>
      ) : (
        <Section title="Data ownership">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="9 12 12 15 16 10" />
            </svg>
            <span style={{ fontSize: 14, color: '#166534' }}>You own your data — your wallet holds the keys.</span>
          </div>
        </Section>
      )}
    </div>
  )
}

// ─── UI primitives ──────────────────────────────────────────────────
function TopBar({ children }: { children: React.ReactNode }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 24px', background: '#fff',
      borderBottom: '1px solid #eee', position: 'sticky', top: 0, zIndex: 5
    }}>
      {children}
    </header>
  )
}

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7, background: '#111',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', color: '#111' }}>Tasks</span>
    </div>
  )
}

function Avatar({ name }: { name: string }) {
  const initial = (name || '?').charAt(0).toUpperCase()
  return (
    <div style={{
      width: 24, height: 24, borderRadius: '50%', background: '#111', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 600
    }}>
      {initial}
    </div>
  )
}

function Modal({ children, onClose, title, wide }: { children: React.ReactNode; onClose: () => void; title: string; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      padding: 16
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: wide ? 560 : 420, width: '100%',
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
      }}>
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid #eee',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0, color: '#111' }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#666'
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#888', margin: '0 0 10px' }}>{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 14 }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{ color: '#111', fontWeight: 500 }}>{children}</span>
    </div>
  )
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left',
      padding: '10px 14px', border: 'none', background: 'transparent',
      fontSize: 14, color: '#111', cursor: 'pointer', borderRadius: 6
    }}
      onMouseOver={e => (e.currentTarget.style.background = '#f5f5f5')}
      onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  )
}

function MenuHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid #eee', marginBottom: 4 }}>
      {children}
    </div>
  )
}

function Spinner() {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%',
      border: '3px solid #e5e5e5', borderTopColor: '#111',
      animation: 'app-spin 0.8s linear infinite', margin: '0 auto'
    }}>
      <style>{`@keyframes app-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
