# API Server

Express API for the RMONE workspace. Handles RMONE proxy/cache, alerts state,
card-insights cache, and AgentMail.

## Database auto-setup

On boot, the server calls `bootstrapDatabase()` (from `@workspace/db`) before
`app.listen()`. This runs `drizzle-kit pushSchema` against `DATABASE_URL` and
auto-creates any missing tables/columns defined in `lib/db/src/schema/`.

- **Single-step setup:** point at any fresh Postgres (AWS RDS, Neon, Supabase,
  local) by setting `DATABASE_URL` — no manual `drizzle-kit push` needed.
- **Idempotent:** restarts no-op when the schema already matches (logs
  `[db] schema up to date — no changes`).
- **Non-destructive:** additive changes only. If drizzle-kit detects a change
  that would drop/rename/retype data (`hasDataLoss`), the server refuses to
  apply it, logs the offending statements, and exits non-zero. Resolve those
  manually with `pnpm --filter @workspace/db push`.
- **Fails loud:** any connection or sync error causes `process.exit(1)`, so
  the server never serves traffic against a half-initialized database.

### SSL

`lib/db` honours both `PGSSLMODE` and the `sslmode=` query parameter on
`DATABASE_URL`. Supported modes: `require`, `no-verify`, `verify-ca`,
`verify-full`. Use `no-verify` (or set `PGSSL_REJECT_UNAUTHORIZED=false`) only
for self-signed dev certs.
