import knexLib, { type Knex } from 'knex'

let db: Knex | undefined

export function initDb(config: Knex.Config): Knex {
  db = knexLib(config)
  return db
}

export function getDb(): Knex {
  if (!db) throw new Error('Auth bridge database not initialized. Call initDb() first.')
  return db
}
