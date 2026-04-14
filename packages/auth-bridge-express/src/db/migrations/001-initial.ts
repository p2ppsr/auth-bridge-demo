import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('auth_bridge_users', (t) => {
    t.increments('id').primary()
    t.string('identity_key', 66).notNullable().unique()
    t.binary('root_key_enc').notNullable()
    t.binary('root_key_iv').notNullable()
    t.string('chain', 4).notNullable().defaultTo('main')
    t.string('custody_status', 16).notNullable().defaultTo('managed')
    t.timestamp('created_at').defaultTo(knex.fn.now())
    t.timestamp('updated_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('auth_bridge_auth_methods', (t) => {
    t.increments('id').primary()
    t.integer('user_id').unsigned().notNullable()
      .references('id').inTable('auth_bridge_users').onDelete('CASCADE')
    t.string('method_type', 32).notNullable()
    t.string('method_id', 255).notNullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
    t.unique(['method_type', 'method_id'])
  })

  await knex.schema.createTable('auth_bridge_sessions', (t) => {
    t.string('id', 64).primary()
    t.integer('user_id').unsigned().notNullable()
      .references('id').inTable('auth_bridge_users').onDelete('CASCADE')
    t.timestamp('expires_at').notNullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
    t.index(['user_id'])
    t.index(['expires_at'])
  })

  await knex.schema.createTable('auth_bridge_magic_links', (t) => {
    t.string('token', 128).primary()
    t.string('email', 255).notNullable()
    t.boolean('verified').notNullable().defaultTo(false)
    t.timestamp('expires_at').notNullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('auth_bridge_migrations', (t) => {
    t.increments('id').primary()
    t.integer('user_id').unsigned().notNullable()
      .references('id').inTable('auth_bridge_users').onDelete('CASCADE')
    t.string('target_identity_key', 66).notNullable()
    t.string('status', 32).notNullable().defaultTo('initiated')
    t.timestamp('completed_at').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auth_bridge_migrations')
  await knex.schema.dropTableIfExists('auth_bridge_magic_links')
  await knex.schema.dropTableIfExists('auth_bridge_sessions')
  await knex.schema.dropTableIfExists('auth_bridge_auth_methods')
  await knex.schema.dropTableIfExists('auth_bridge_users')
}
