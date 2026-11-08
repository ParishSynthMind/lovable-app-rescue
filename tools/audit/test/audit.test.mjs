import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { audit, checkMigrations, checkBrowserSecrets } from "../lovable-audit.mjs";

const jwt = (role) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url"), "c2lnbmF0dXJlLXBsYWNlaG9sZGVy"].join(".");

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "audit-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const rules = (fs) => fs.map((f) => f.rule).sort();

test("service_role key in browser code is high, anon key is only low", () => {
  const svc = checkBrowserSecrets("src/x.ts", `const k = "${jwt("service_role")}";`);
  assert.equal(svc[0].rule, "service-role-key-in-browser");
  assert.equal(svc[0].severity, "high");
  const anon = checkBrowserSecrets("src/x.ts", `const k = "${jwt("anon")}";`);
  assert.equal(anon[0].rule, "hardcoded-anon-key");
  assert.equal(anon[0].severity, "low");
});

test("AI keys, public secret env vars and direct AI calls in the browser are flagged", () => {
  const text = [
    'const a = "sk-ant-api03-abcdefghijklmnop";',
    "const b = import.meta.env.VITE_ANTHROPIC_API_KEY;",
    'fetch("https://api.anthropic.com/v1/messages")',
  ].join("\n");
  assert.deepEqual(rules(checkBrowserSecrets("src/ai.ts", text)), ["ai-api-called-from-browser", "secret-env-exposed", "secret-in-browser"]);
});

test("secrets in server code (Edge Functions) are not flagged", () => {
  const root = project({
    "supabase/functions/triage/index.ts": 'fetch("https://api.anthropic.com/v1/messages"); Deno.env.get("ANTHROPIC_API_KEY")',
    "src/App.tsx": "export default () => null;",
    "src/App.test.tsx": "",
  });
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  assert.deepEqual(audit(root), []);
});

test("table without RLS is high", () => {
  const f = checkMigrations([{ rel: "supabase/migrations/1.sql", text: "create table public.requests (id uuid primary key);" }]);
  assert.deepEqual(rules(f), ["rls-disabled"]);
});

test("RLS enabled with owner policies passes", () => {
  const sql = `
    create table public.requests (id uuid primary key, user_id uuid not null);
    alter table public.requests enable row level security;
    create policy "own rows" on public.requests for select to authenticated using (auth.uid() = user_id);
    create policy "own insert" on public.requests for insert to authenticated with check (auth.uid() = user_id);
    create policy "own update" on public.requests for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);`;
  assert.deepEqual(checkMigrations([{ rel: "m.sql", text: sql }]), []);
});

test("'true' policies: writes are high, reads are medium", () => {
  const sql = `
    create table requests (id uuid primary key);
    alter table requests enable row level security;
    create policy "Anyone can view" on requests for select using (true);
    create policy "Anyone can update" on requests for update to authenticated using (true) with check (true);`;
  const f = checkMigrations([{ rel: "m.sql", text: sql }]);
  assert.deepEqual(rules(f), ["policy-allows-everyone", "policy-reads-everything"]);
  assert.equal(f.find((x) => x.rule === "policy-allows-everyone").severity, "high");
});

test("update policy without WITH CHECK is medium", () => {
  const sql = `create table t (id uuid, user_id uuid); alter table t enable row level security;
    create policy "upd" on t for update using (auth.uid() = user_id);`;
  assert.deepEqual(rules(checkMigrations([{ rel: "m.sql", text: sql }])), ["update-without-check"]);
});

test("role column on a self-updatable profiles table = self-promotion to admin", () => {
  const sql = `
    create table public.profiles (id uuid primary key references auth.users, full_name text, role text default 'client');
    alter table public.profiles enable row level security;
    create policy "Users update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);`;
  assert.deepEqual(rules(checkMigrations([{ rel: "m.sql", text: sql }])), ["self-promote-to-admin"]);
  // revoking update on the table (column grants instead) clears it
  const fixed = sql + "\nrevoke update on table public.profiles from authenticated; grant update (full_name) on public.profiles to authenticated;";
  assert.deepEqual(checkMigrations([{ rel: "m.sql", text: fixed }]), []);
});

test("a later migration that disables RLS wins over an earlier enable", () => {
  const f = checkMigrations([
    { rel: "1.sql", text: "create table t (id int); alter table t enable row level security;" },
    { rel: "2.sql", text: "alter table t disable row level security;" },
  ]);
  assert.deepEqual(rules(f), ["rls-disabled"]);
});

test("commented-out SQL is ignored", () => {
  const f = checkMigrations([{ rel: "1.sql", text: "-- create table t (id int);\n/* create table u (id int); */" }]);
  assert.deepEqual(f, []);
});

test("whole-project scan: role in localStorage, .env committed, no tests, no CI", () => {
  const root = project({
    "src/pages/Admin.tsx": 'if (localStorage.getItem("role") === "admin") show();',
    ".env": "VITE_SUPABASE_URL=https://example.supabase.co",
    ".env.example": "VITE_SUPABASE_URL=",
  });
  assert.deepEqual(rules(audit(root)), ["env-file-committed", "no-ci", "no-tests", "role-in-localstorage"]);
});

test("whole-row UPDATE grant with an own-row policy exposes email and timestamps", () => {
  const sql = `
    create table public.profiles (id uuid primary key, email text not null, full_name text, created_at timestamptz);
    grant select, update on public.profiles to authenticated;
    alter table public.profiles enable row level security;
    create policy "own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());`;
  const f = checkMigrations([{ rel: "m.sql", text: sql }]);
  assert.deepEqual(rules(f), ["whole-row-update"]);
  assert.match(f[0].message, /email, created_at/);
  const fixed = sql.replace("grant select, update on public.profiles to authenticated;", "grant select, update (full_name) on public.profiles to authenticated;");
  assert.deepEqual(checkMigrations([{ rel: "m.sql", text: fixed }]), []);
});

test("admin-only update policies do not count as own-row updates", () => {
  const sql = `
    create table t (id uuid primary key, client_id uuid, status text);
    grant update on t to authenticated;
    alter table t enable row level security;
    create policy "admins" on t for update to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));`;
  assert.deepEqual(checkMigrations([{ rel: "m.sql", text: sql }]), []);
});

test("SECURITY DEFINER function needs EXECUTE revoked from public; trigger functions are skipped", () => {
  const fn = "create or replace function public.has_role(_u uuid, _r text) returns boolean language sql stable security definer set search_path = public as $$ select true $$;";
  const trig = "create or replace function public.handle_new_user() returns trigger language plpgsql security definer as $$ begin return new; end $$;";
  assert.deepEqual(rules(checkMigrations([{ rel: "m.sql", text: fn + trig }])), ["definer-function-callable-by-anyone"]);
  const fixed = fn + "\nrevoke execute on function public.has_role(uuid, text) from public, anon;";
  assert.deepEqual(checkMigrations([{ rel: "m.sql", text: fixed }]), []);
});

test("Lovable Cloud export: drizzle-only schema and .env not ignored are flagged", () => {
  const root = project({
    "drizzle/migrations/0000_migration.sql": "create table t (id int); alter table t enable row level security;",
    ".gitignore": "node_modules\ndist\n",
    "src/App.test.tsx": "",
  });
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  assert.deepEqual(rules(audit(root)), ["env-not-gitignored", "no-database-tests", "schema-not-in-supabase-migrations"]);
});
