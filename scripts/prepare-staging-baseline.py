#!/usr/bin/env python3
"""Prepare SQL for a NEW, EMPTY Supabase staging project. No network access."""
import argparse
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
MARKER = 'create type public.booking_status'

def prepare():
    snapshot = (ROOT / 'tests/exported-schema.sql').read_text()
    if snapshot.count(MARKER) != 1:
        raise ValueError('Unexpected exported schema structure; review before proceeding.')
    application = snapshot[snapshot.index(MARKER):]
    forbidden = ('create role ', 'create schema auth', 'create function auth.', 'create table auth.users')
    if any(value in application.lower() for value in forbidden):
        raise ValueError('Auth test scaffolding must never be copied to hosted Supabase.')
    header = '''-- STAGING ONLY: for a NEW, EMPTY Supabase project, never the live app.
-- Contains schema and fictional test packages; no customer records or credentials.
-- Existing managed auth tables/functions and roles are preserved.
begin;
do $staging_preflight$
begin
 if to_regclass('auth.users') is null or to_regprocedure('auth.uid()') is null then
  raise exception 'Expected an existing Supabase Auth installation';
 end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p','v','m','S')) then
  raise exception 'Staging bootstrap requires an empty public schema; refusing existing database';
 end if;
 if exists(select 1 from auth.users) then
  raise exception 'Staging bootstrap requires no existing Auth users; refusing existing database';
 end if;
end
$staging_preflight$;
'''
    catalog = '''
-- Fictional prices for Stripe TEST MODE acceptance only.
insert into public.packages(name,description,access_type,credit_type,credits,price_cents,duration_days,recurring,payment_type,active,sort_order)
values
 ('STAGING Group 5-Pack','Test fixture only','credits','group',5,100,null,false,'one_time',true,10),
 ('STAGING Private Single','Test fixture only','credits','private',1,100,null,false,'one_time',true,20),
 ('STAGING Group Monthly','Test fixture only','membership','group',null,100,30,true,'subscription',true,30),
 ('STAGING Track Monthly','Test fixture only','membership','track',null,100,30,true,'subscription',true,40);
commit;
'''
    return header + application + catalog

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', required=True, type=Path)
    args = p.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(prepare())
    print(f'Prepared staging-only SQL: {args.output}. No database connection or deployment occurred.')
