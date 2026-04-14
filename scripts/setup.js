#!/usr/bin/env node

/**
 * Setup script — generates .env from .env.example with random secrets.
 * Safe to re-run: won't overwrite an existing .env.
 */

import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const envPath = join(root, '.env')
const examplePath = join(root, '.env.example')

if (existsSync(envPath)) {
  console.log('.env already exists — skipping. Delete it and re-run to regenerate.')
  process.exit(0)
}

const genHex = () => randomBytes(32).toString('hex')

let content = readFileSync(examplePath, 'utf-8')

// Auto-generate secrets
content = content.replace(
  /^SERVER_WALLET_KEY=$/m,
  `SERVER_WALLET_KEY=${genHex()}`
)
content = content.replace(
  /^AUTH_BRIDGE_KEY=$/m,
  `AUTH_BRIDGE_KEY=${genHex()}`
)
content = content.replace(
  /^AUTH_BRIDGE_JWT_SECRET=$/m,
  `AUTH_BRIDGE_JWT_SECRET=${genHex()}`
)

writeFileSync(envPath, content)
console.log('Created .env with generated secrets.')
console.log()
console.log('Next steps:')
console.log('  1. (Optional) Add your Google OAuth credentials to .env')
console.log('  2. npm run db:up          # Start MySQL')
console.log('  3. npm run install:all    # Install dependencies')
console.log('  4. npm run dev:backend    # Start backend (terminal 1)')
console.log('  5. npm run dev:frontend   # Start frontend (terminal 2)')
console.log()
console.log('Email magic links will be printed to the backend console.')
