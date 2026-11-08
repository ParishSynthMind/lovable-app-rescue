# Audit of app (as exported by Lovable, commit 0a0a95c)

High: 0  Medium: 4  Low: 3

- **MEDIUM** `env-not-gitignored` .gitignore:1: .env is not in .gitignore, so keys end up in git history the first time someone commits.
- **MEDIUM** `schema-not-in-supabase-migrations` drizzle/migrations: The schema only exists as a Drizzle export, so `supabase start` / `supabase db push` will not create it. The app cannot run outside the builder's cloud until it moves to supabase/migrations.
- **MEDIUM** `whole-row-update` drizzle/migrations/0000_migration.sql:12: Users can update every column of their own "profiles" row, including email, created_at. Grant UPDATE on the editable columns only.
- **MEDIUM** `raw-html` src/components/ui/chart.tsx:73: dangerouslySetInnerHTML renders raw HTML. Fine for trusted constants, an XSS hole for user or AI text.
- **LOW** `no-database-tests` .: The database has security rules but no tests prove them (for example pgTAP in supabase/tests).
- **LOW** `no-ci` .: No CI workflow, so nothing checks a change before it ships.
- **LOW** `definer-function-callable-by-anyone` drizzle/migrations/0000_migration.sql:26: SECURITY DEFINER function has_role() can be called by anyone, signed in or not (EXECUTE is granted to PUBLIC by default). Revoke it from public and anon.
