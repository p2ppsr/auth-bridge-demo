# Adding BRC-100 to a Web2 app

This guide is for developers who have an existing app with traditional auth (Supabase, Clerk, Auth0, custom email/password, etc.) and want to add a BRC-100 wallet path without rewriting their auth stack. It covers the architecture, the data model trade-offs, and integration pointers.

If you just want to see it work end-to-end, the [auth-bridge-demo repo](https://github.com/p2ppsr/auth-bridge-demo) is the reference implementation.

---

## The core idea

Instead of forcing every new user to install a BRC-100 wallet before they can use your app, you run a **managed wallet per user on the server**. Users sign in with Google / email / Supabase / whatever you already support. Behind the scenes the server creates a wallet-toolbox wallet for them and uses it on their behalf. When a user is ready to take full custody, they connect their own BRC-100 wallet, the server transfers everything over, and then zeros its copy of the keys.

From that point on, the user logs in with their wallet and the server never touches their data again.

```
┌──────────────────────────────────────┐
│  Frontend                            │
│  ┌──────────────┐  ┌──────────────┐  │
│  │ your web2    │  │ "Connect     │  │
│  │ login        │  │ BRC-100"     │  │
│  └──────┬───────┘  └──────┬───────┘  │
└─────────┼──────────────────┼─────────┘
          │                  │
          ▼                  ▼
┌──────────────────────────────────────┐
│  Backend                             │
│  ┌──────────────┐  ┌──────────────┐  │
│  │ managed      │  │ AuthFetch    │  │
│  │ wallet per   │  │ mutual auth  │  │
│  │ user         │  │ handshake    │  │
│  └──────┬───────┘  └──────┬───────┘  │
│         │                  │         │
│         └─────────┬────────┘         │
│                   ▼                  │
│         req.auth.identityKey         │
│         (same shape either way)      │
└──────────────────────────────────────┘
```

The key property: **downstream code doesn't care which path a user took**. Both flows produce a BRC-100 identity key your app can work with.

---

## The data model question

This is where the architecture gets interesting. BRC-100 separates data into two very different categories and your app probably needs both.

### Private user data → wallet baskets

Each user's wallet has **baskets**, which are collections of UTXOs (on-chain outputs) that only that user can read or spend. Data is encrypted client-side with the user's key before being locked into a PushDrop token. Only the holder of the private key can unlock and decrypt.

**Perfect for**: todos, notes, saved files, drafts, anything scoped to one user.

**How you work with it**: `wallet.createAction()`, `wallet.listOutputs({ basket: 'your-basket' })`, `wallet.encrypt()` / `wallet.decrypt()`, PushDrop tokens for structured payloads.

**For the managed-wallet path**: your backend calls these same methods on behalf of the user. The auth-bridge-demo proxies them through a `POST /auth/wallet/call` RPC endpoint so the frontend code is identical whether the wallet is local or server-managed.

### Public / shared data → overlays

For anything multiple users need to see (marketplace listings, tweets, chat channels, leaderboards, shared documents), wallet baskets don't work. The data has to live somewhere publicly queryable.

BRC-100 apps solve this with **overlays**: a publish/subscribe system where apps broadcast transactions carrying data to a **topic manager**, and clients query a **lookup service** to find relevant transactions. The topic manager validates incoming data, the lookup service indexes it for queries.

**Perfect for**: listings, posts, chat rooms, anything that needs to be discoverable by users other than the author.

**Your options**:

1. **Build an app-specific overlay**. You define the token format, write a topic manager that validates it, and a lookup service that indexes it the way your queries need. This is the most common choice but it's real work (one topic manager + one lookup service per data type, typically in a separate repo, deployed as its own service).

2. **Use a generic overlay** like `GlobalKVStore` or `SHIP`. Good for key-value data or simple indexing, no custom infra needed, but less flexibility.

3. **Hybrid**: store the heavy lifting (the actual content) in the user's basket, and put just a small public pointer/metadata onto an overlay. Lets you keep most data encrypted and private while still making things discoverable.

**For your app**: this part is application-specific. There's no one-size-fits-all "add an overlay" step, so the best path is to figure out exactly what data needs to be shared vs. private before you start.

### The migration problem with overlay data

This is worth calling out explicitly because it's awkward.

Overlay tokens are locked under whoever's key signed the `createAction` that published them. If a managed-wallet user published a listing, a post, a chat message, etc. while on the managed path, those tokens are spendable by the managed wallet's key, not the user's self-sovereign key.

When the user migrates, **the user doesn't control that data** in the cryptographic sense. The managed wallet still technically owns the on-chain outputs. That's a genuine gap, and there's no fully clean solution yet. Real options:

1. **Sweep and rebroadcast**. During migration, the managed wallet spends all overlay tokens and rebroadcasts equivalent tokens signed by the user's new key. Works but is expensive (one tx per token, fees, possibly re-indexing lag), and the overlay history shows two separate token lineages with different owners (old ones spent, new ones published).

2. **Migration reference tokens**. Sweep the old tokens into a single migration tx that references the new key, and publish new tokens under the new key with a pointer back. Lets overlay lookups reconstruct the identity lineage. Still costs one sweep tx plus N rebroadcasts.

3. **Use mutable/updatable tokens from the start**. Design your overlay so tokens are expected to be "updated" (old UTXO spent, new UTXO created). Build the topic manager to accept a new token signed by a different key if it references a previous token and includes a signature from the previous key authorizing the handoff. This is the cleanest pattern, but you have to design for it upfront.

4. **Leave the old data orphaned, publish fresh under the new key**. Simplest, acceptable for use cases where history doesn't matter much (short-lived chat, transient notices). Loses continuity.

5. **Key-anchored, not UTXO-anchored identity**. Make your overlay's identity model point at a per-user key reference maintained in a separate registry (e.g. GlobalKVStore), not at the original publishing key. When a user migrates, you update the registry to point at the new key, and existing tokens remain discoverable via that indirection. Adds a moving part but avoids rebroadcasting everything.

In practice, most apps will end up with **a mix** (e.g., option 4 for ephemeral data, option 1 or 2 for anything the user wants to keep). The honest answer: if full cryptographic ownership of overlay data matters for your app, you want option 3 — design the handoff in from day one. If you're bolting this onto an existing overlay, options 1, 2, and 5 are your choices.

The auth-bridge-demo doesn't try to solve this because its only data is wallet-basket todos. If you're building on overlays, plan the migration path for overlay data before you ship, not after.

---

## Integration: the five pieces

If you have an app with Supabase Auth (or any similar auth provider) and want to add the BRC-100 path, these are the five pieces you'll need.

### 1. Managed wallet per user

Every user needs a server-side BRC-100 wallet. Use `@bsv/wallet-toolbox`'s `SetupClient.createWalletClientNoEnv`:

```ts
import { SetupClient } from '@bsv/wallet-toolbox'

const wallet = await SetupClient.createWalletClientNoEnv({
  chain: 'main',
  rootKeyHex,                       // random 32-byte hex, per user
  storageUrl: 'https://storage.babbage.systems'
})
```

Store the encrypted `rootKeyHex` in your database. On every request, look it up, decrypt it, and instantiate the wallet. Cache the wallet per session (instantiating it hits the storage server and is not free).

**Linking to Supabase**: add a table like `user_wallets(supabase_user_id, identity_key, root_key_enc, root_key_iv, custody_status)` and look up by the Supabase user ID on login. If there's no row, create a new wallet. If the status is `sovereign`, redirect them to connect their BRC-100 wallet instead.

### 2. Key encryption at rest

Never store raw root keys. AES-256-GCM with a key you hold in an env var (or a KMS) is fine. The auth-bridge-demo's [`KeyVault.ts`](../packages/auth-bridge-express/src/managed-wallet/KeyVault.ts) is a minimal implementation you can copy.

### 3. BRC-100 auth path alongside your existing auth

Mount `@bsv/auth-express-middleware` at your app root so `/.well-known/auth` is reachable by `AuthFetch`:

```ts
import { createAuthMiddleware } from '@bsv/auth-express-middleware'

app.use(createAuthMiddleware({
  wallet: yourServerWallet,         // NOT the per-user wallet — your own
  allowUnauthenticated: true
}))
```

Then add one endpoint that takes a mutually-authenticated request and issues a session for that identity key:

```ts
app.post('/brc100/session', (req, res) => {
  const identityKey = req.auth?.identityKey
  // look up or create user by identity key, issue your normal session
})
```

This is parallel to your Supabase login, not a replacement. A user who signed up with Google should be able to later connect their wallet and link it to their existing row.

### 4. Wallet proxy endpoint (optional but nice)

If your frontend needs to do wallet things (encrypt, createAction, listOutputs) and the user is on the managed path, you can expose a tightly-scoped RPC endpoint that proxies calls to their managed wallet. See [`walletProxy.ts`](../packages/auth-bridge-express/src/handlers/walletProxy.ts) for a whitelisted implementation.

This lets your frontend code use the same `WalletInterface` API whether the user has a local wallet or a managed one:

```ts
const wallet = session.isManagedWallet
  ? new ProxyWalletClient('/auth')    // RPC to server
  : new WalletClient()                // local BRC-100 wallet

// Either way:
await wallet.encrypt({ plaintext, protocolID, keyID })
```

### 5. Migration

When a user wants to go self-sovereign:

1. **Transfer wallet-basket data**. For each basket (funds + private data), the managed wallet creates a BRC-29 payment or re-encrypted PushDrop to the target wallet's identity key. The target wallet calls `internalizeAction` to receive it.
   - Funds (a normal UTXO in the default basket) move directly via BRC-29.
   - Encrypted data (todo tokens, notes, etc.) can't just be re-owned because it's encrypted under the managed wallet's keys. The server has to decrypt and hand over the plaintext, and the client re-encrypts and re-creates the tokens under the target wallet.
2. **Leave overlay data alone**. Anything on overlays is already public. If the data is identified by identity key, you may want to re-broadcast the same content under the new key so the user's new wallet sees it as "theirs."
3. **Zero the server key**. Wipe the encrypted root key from your DB and mark the user as `sovereign`. Delete sessions. Block the Supabase login path for this user (or redirect them to "use your wallet").

The auth-bridge-demo's [`migrate.ts`](../packages/auth-bridge-express/src/handlers/migrate.ts) and [`MigrationWizard.tsx`](../packages/auth-bridge-react/src/components/MigrationWizard.tsx) show both ends of this flow with progress UI.

---

## Supabase-specific notes

Supabase Auth gives you a JWT and a stable user ID. Plug those into this architecture like so:

- **Signup**: after Supabase confirms the user, check your `user_wallets` table for their Supabase user ID. If missing, generate `rootKeyHex`, instantiate the managed wallet, store the encrypted key, insert the row.
- **Login**: your normal Supabase session middleware populates `req.user`. Add a second middleware after it that loads the corresponding managed wallet (if the user is on the managed path) and exposes it on the request.
- **BRC-100 path**: the `/brc100/session` endpoint above creates a Supabase-equivalent session. You could even issue a Supabase custom JWT using the service key so everything downstream of that looks identical to your Google/email path.

If you're already using Supabase RLS for row access control, keep using it. The auth-bridge model is about who owns which keys, not who can read which rows. Your RLS policies keyed on `supabase_user_id` work fine with either auth path.

---

## What's application-specific

Things this architecture doesn't prescribe:

- **Which overlays you use**. Up to you and what data you're sharing.
- **How/whether to re-broadcast public data under the user's new key after migration**. Depends on your discovery model.
- **Fee handling**. Demo funds new wallets from a server-side faucet so they have sats to create tokens with. In production you'd want a rate-limited funding strategy (or require users to bring their own sats once they migrate).
- **Multi-device for managed users**. The user's "wallet" lives on your server, so logging in from a new device Just Works. For BRC-100 users, they need their wallet on that device — your app can't help with that, but the users who've chosen self-custody will understand.

---

## Where to look in the demo repo

| What | Where |
|------|-------|
| Managed wallet per-user lifecycle | [`packages/auth-bridge-express/src/managed-wallet/WalletPool.ts`](../packages/auth-bridge-express/src/managed-wallet/WalletPool.ts) |
| Root key encryption | [`packages/auth-bridge-express/src/managed-wallet/KeyVault.ts`](../packages/auth-bridge-express/src/managed-wallet/KeyVault.ts) |
| Wallet proxy RPC | [`packages/auth-bridge-express/src/handlers/walletProxy.ts`](../packages/auth-bridge-express/src/handlers/walletProxy.ts) |
| BRC-100 session exchange | [`packages/auth-bridge-express/src/handlers/brc100.ts`](../packages/auth-bridge-express/src/handlers/brc100.ts) |
| Migration flow | [`packages/auth-bridge-express/src/handlers/migrate.ts`](../packages/auth-bridge-express/src/handlers/migrate.ts) |
| React migration wizard | [`packages/auth-bridge-react/src/components/MigrationWizard.tsx`](../packages/auth-bridge-react/src/components/MigrationWizard.tsx) |

---

## Caveats

This is a prototype, not a hardened product. Before you ship something like this, you want:

- **Proper encryption at rest** (KMS, not an env var)
- **Backups** of the encrypted key store (if you lose it, managed users lose their data)
- **Careful fee accounting** (the server is spending sats on behalf of users)
- **Rate limiting** on signup (the funding faucet is a spam target)
- **An audit** before holding real value on behalf of users
- **A legal/regulatory look** at what it means to custody keys on users' behalf in your jurisdiction

The goal of the pattern is to remove the "install a wallet first" wall without compromising the end state: users who want full sovereignty get it, users who don't are still on BRC-100 rails the whole time.
