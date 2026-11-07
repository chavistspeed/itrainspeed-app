import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PGlite } from '@electric-sql/pglite'
const snapshot = await readFile(new URL('./exported-schema.sql', import.meta.url), 'utf8')
const scaffolding = snapshot.slice(0, snapshot.indexOf('create type public.booking_status'))
const dir = await mkdtemp(join(tmpdir(), 'itrain-staging-'))
let sql
try {
 const output = join(dir, 'baseline.sql')
 execFileSync('python3', ['scripts/prepare-staging-baseline.py', '--output', output])
 sql = await readFile(output, 'utf8')
} finally { await rm(dir, { recursive: true, force: true }) }

test('staging bootstrap preserves managed Auth and creates the exported app schema', async () => {
 const db = new PGlite()
 try {
  await db.exec(scaffolding)
  const before = (await db.query("select pg_get_functiondef('auth.uid()'::regprocedure) body")).rows[0].body
  assert.doesNotMatch(sql, /create role |create schema auth|create function auth\.|create table auth\.users/i)
  await db.exec(sql)
  assert.equal((await db.query("select pg_get_functiondef('auth.uid()'::regprocedure) body")).rows[0].body, before)
  assert.equal((await db.query('select count(*)::int n from packages')).rows[0].n, 4)
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n, 0)
  await db.exec(await readFile(new URL('../supabase/v1-6-intro-approval.sql', import.meta.url), 'utf8'))
 } finally { await db.close() }
})
test('staging bootstrap refuses any existing application schema', async () => {
 const db = new PGlite()
 try {
  await db.exec(scaffolding)
  await db.exec('create table public.existing_app(id int)')
  await assert.rejects(db.exec(sql), /empty public schema/)
  await db.exec('rollback')
  assert.equal((await db.query("select to_regclass('public.packages') object")).rows[0].object, null)
 } finally { await db.close() }
})
test('staging bootstrap refuses existing users without an application schema', async () => {
 const db = new PGlite()
 try {
  await db.exec(scaffolding)
  await db.exec("insert into auth.users(id) values('00000000-0000-0000-0000-000000000001')")
  await assert.rejects(db.exec(sql), /no existing Auth users/)
  await db.exec('rollback')
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n, 1)
 } finally { await db.close() }
})
