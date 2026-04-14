import React, { useState, useEffect, useCallback } from 'react'
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

export function App() {
  const providers: ('google' | 'email' | 'brc100')[] = ['email', 'brc100']
  if (GOOGLE_CLIENT_ID) providers.unshift('google')

  return (
    <AuthBridgeProvider serverUrl="/auth" googleClientId={GOOGLE_CLIENT_ID} providers={providers}>
      <Layout />
    </AuthBridgeProvider>
  )
}

function Layout() {
  const { session, isLoading } = useAuthBridge()
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Auth Bridge Todo Demo</h1>
        <p style={{ color: '#64748b', margin: '6px 0 0', fontSize: 14 }}>
          Login &rarr; Create todos on-chain &rarr; Migrate to self-sovereign
        </p>
      </header>
      {isLoading ? <p style={{ textAlign: 'center', color: '#94a3b8' }}>Loading...</p>
        : !session ? <LoginCard />
        : <TodoApp />}
    </div>
  )
}

function LoginCard() {
  return (
    <div style={card}>
      <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16, textAlign: 'center' }}>Sign in to get started</h2>
      <AuthBridgeLogin />
    </div>
  )
}

function TodoApp() {
  const { session, logout, serverUrl } = useAuthBridge()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [creating, setCreating] = useState(false)
  const [showMigration, setShowMigration] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create a ProxyWalletClient for managed wallets, or use WalletClient for BRC-100
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

  // Load existing todos
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
            ciphertext: drop.fields[1],
            protocolID: PROTOCOL_ID,
            keyID: KEY_ID
          })
          decoded.push({
            task: Utils.toUTF8(decResult.plaintext),
            sats: output.satoshis ?? 0,
            outpoint: output.outpoint,
            lockingScript: ls.toHex(),
            beef: result.BEEF as number[]
          })
        } catch (e) {
          console.warn('Failed to decode task:', e)
        }
      }
      setTasks(decoded.reverse())
    } catch (e: any) {
      if (e.message?.includes('Wallet proxy only')) {
        setTasks([])
      } else {
        setError(e.message)
      }
    } finally {
      setLoading(false)
    }
  }, [getWallet])

  useEffect(() => { loadTasks() }, [loadTasks])

  // Create a new todo
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTask.trim()) return
    setCreating(true)
    setError(null)
    try {
      const wallet = await getWallet()
      const encrypted = await wallet.encrypt({
        plaintext: Utils.toArray(newTask, 'utf8'),
        protocolID: PROTOCOL_ID,
        keyID: KEY_ID
      })
      const pushdrop = new PushDrop(wallet)
      const lockScript = await pushdrop.lock(
        [Utils.toArray(TODO_PROTO_ADDR, 'utf8'), encrypted.ciphertext],
        PROTOCOL_ID, KEY_ID, 'self'
      )
      const result = await wallet.createAction({
        outputs: [{
          lockingScript: lockScript.toHex(),
          satoshis: 1,
          basket: 'todo tokens',
          outputDescription: 'Todo item'
        }],
        options: { randomizeOutputs: false, acceptDelayedBroadcast: true },
        description: `Create TODO: ${newTask}`
      })
      setTasks(prev => [{
        task: newTask,
        sats: 1,
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

  // Complete (redeem) a todo
  const handleComplete = async (task: Task) => {
    setError(null)
    try {
      const wallet = await getWallet()
      let description = `Complete TODO: "${task.task}"`
      if (description.length > 128) description = description.substring(0, 128)

      const { signableTransaction } = await wallet.createAction({
        description,
        inputBEEF: task.beef,
        inputs: [{
          inputDescription: 'Complete todo item',
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
      setTasks(prev => prev.filter(t => t.outpoint !== task.outpoint))
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (!session) return null

  return (
    <>
      {/* Session bar */}
      <div style={{ ...card, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {session.authMethod === 'brc100' ? 'Self-sovereign' : 'Managed'} &middot; {session.authMethod}
            {session.email && ` &middot; ${session.email}`}
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8', marginTop: 2 }}>
            {session.identityKey.substring(0, 16)}...
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {session.isManagedWallet && (
            <button onClick={() => setShowMigration(!showMigration)} style={{ ...smallBtn, background: '#eff6ff', color: '#2563eb', borderColor: '#93c5fd' }}>
              {showMigration ? 'Hide' : 'Migrate'}
            </button>
          )}
          <button onClick={logout} style={{ ...smallBtn, background: '#fef2f2', color: '#dc2626', borderColor: '#fca5a5' }}>
            Logout
          </button>
        </div>
      </div>

      {/* Migration wizard */}
      {showMigration && (
        <div style={card}>
          <MigrationWizard onComplete={() => { setShowMigration(false) }} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ ...card, background: '#fef2f2', color: '#dc2626', padding: '10px 14px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Create todo */}
      <div style={card}>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="What needs to be done?"
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            disabled={creating}
            style={{ flex: 1, padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
          />
          <button
            type="submit"
            disabled={creating || !newTask.trim()}
            style={{ ...smallBtn, background: '#2563eb', color: '#fff', borderColor: '#2563eb', opacity: creating ? 0.6 : 1 }}
          >
            {creating ? '...' : 'Add'}
          </button>
        </form>
      </div>

      {/* Task list */}
      <div style={card}>
        <h3 style={{ fontSize: 15, fontWeight: 500, margin: '0 0 12px' }}>
          On-chain Todos {tasks.length > 0 && <span style={{ color: '#94a3b8', fontWeight: 400 }}>({tasks.length})</span>}
        </h3>
        {loading ? (
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Loading todos from blockchain...</p>
        ) : tasks.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 14 }}>No todos yet. Create one above!</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {tasks.map(task => (
              <li key={task.outpoint} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 0', borderBottom: '1px solid #f1f5f9'
              }}>
                <button
                  onClick={() => handleComplete(task)}
                  title="Mark complete (redeems token)"
                  style={{
                    width: 22, height: 22, borderRadius: '50%', border: '2px solid #cbd5e1',
                    background: 'none', cursor: 'pointer', flexShrink: 0
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14 }}>{task.task}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
                    {task.sats} sat &middot;{' '}
                    <a
                      href={`https://whatsonchain.com/tx/${task.outpoint.split('.')[0]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#2563eb', textDecoration: 'none' }}
                      onClick={e => e.stopPropagation()}
                    >
                      {task.outpoint.split('.')[0].substring(0, 12)}...
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 20,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 12
}

const smallBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid #ddd',
  fontSize: 13, fontWeight: 500, cursor: 'pointer', background: '#fff'
}
