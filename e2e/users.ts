/**
 * Throwaway test users for the end-to-end tests. They are inserted straight into
 * Supabase Auth (confirmed, with a known password) through the database URL, so the
 * tests can sign in through the real login page. Every address ends in @e2e.invalid,
 * which is how cleanup finds them.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as typeof import('pg')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dbUrl = require('../scripts/dbUrl.cjs') as () => string

export const PASSWORD = 'E2e-Password-123'
export const DOMAIN = '@e2e.invalid'

export type TestUser = { email: string; username: string }

export const USERS: TestUser[] = ['a', 'b', 'c'].map((k) => ({ email: `e2e-${k}${DOMAIN}`, username: `e2e${k}` }))

export async function withDb<T>(fn: (c: import('pg').Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** Delete every e2e user and everything they own. Safe to run any time. */
export async function cleanupE2e(): Promise<void> {
  await withDb(async (c) => {
    const ids = (await c.query('select id from auth.users where email like $1', ['%' + DOMAIN])).rows.map((r) => r.id as string)
    if (ids.length === 0) return
    // rooms first (the order keeps foreign keys happy even where a cascade is missing)
    await c.query('delete from public.draft_rooms where owner_id = any($1::uuid[])', [ids]).catch(() => {})
    await c.query('delete from public.rooms where admin_user_id = any($1::uuid[])', [ids]).catch(() => {})
    await c.query('delete from public.draft_members where user_id = any($1::uuid[])', [ids]).catch(() => {})
    await c.query('delete from public.room_users where user_id = any($1::uuid[])', [ids]).catch(() => {})
    await c.query('delete from auth.identities where user_id = any($1::uuid[])', [ids]).catch(() => {})
    await c.query('delete from auth.users where id = any($1::uuid[])', [ids])
  })
}

/** Create the users fresh (removing any left over from an earlier run). */
export async function createUsers(): Promise<void> {
  await cleanupE2e()
  await withDb(async (c) => {
    for (const u of USERS) {
      const id = (await c.query('select gen_random_uuid() id')).rows[0].id as string
      await c.query(
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                                 raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                                 confirmation_token, recovery_token, email_change, email_change_token_new)
         values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, crypt($3, gen_salt('bf')), now(),
                 '{"provider":"email","providers":["email"]}'::jsonb, $4::jsonb, now(), now(), '', '', '', '')`,
        [id, u.email, PASSWORD, JSON.stringify({ username: u.username })]
      )
      await c.query(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         values ($1::text, $2::uuid, $3::jsonb, 'email', now(), now(), now())`,
        [id, id, JSON.stringify({ sub: id, email: u.email, email_verified: true })]
      )
    }
  })
}
