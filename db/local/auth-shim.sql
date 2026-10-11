-- Local development only. DO NOT run this against Supabase.
--
-- Migration 001 declares `public.users.id references auth.users(id)`, so that
-- application rows cannot outlive the identity they belong to. On Supabase the
-- `auth` schema is provided by the platform; on a plain PostgreSQL server it
-- does not exist, and 001 fails with `schema "auth" does not exist`.
--
-- This creates the smallest stand-in that satisfies that foreign key: the id
-- column it points at, plus the email the app reads back. It is deliberately
-- NOT a reimplementation of Supabase auth -- there are no passwords, sessions
-- or policies here, and nothing authenticates against it. Tokens are still
-- verified by the real `requireAuth` against a JWKS, which in local development
-- is served by api/scripts/local-auth.mjs.
--
-- Run it BEFORE the migrations, against a local database only:
--   psql -h 127.0.0.1 -p 5433 -d astroai -f db/local/auth-shim.sql

create schema if not exists auth;

create table if not exists auth.users (
  id         uuid primary key,
  email      text,
  created_at timestamptz not null default now()
);

comment on table auth.users is
  'Local stand-in for Supabase auth.users. Not present in production, where the platform provides this schema.';

-- The user that api/scripts/local-auth.mjs mints tokens for, so an authenticated
-- local request has an identity its rows can reference.
insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'loadtest@example.invalid')
on conflict (id) do nothing;
