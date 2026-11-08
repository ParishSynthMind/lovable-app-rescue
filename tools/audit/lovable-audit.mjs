#!/usr/bin/env node
// Scans an app exported from an AI app builder (Lovable, Base44, Bolt, Replit)
// for the problems those exports usually ship with. No dependencies.
//   node tools/audit/lovable-audit.mjs <app-folder> [--json] [--fail-on high|medium|none]
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".vercel"]);
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".html"]);
const RANK = { high: 3, medium: 2, low: 1 };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function decodeJwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.role || null;
  } catch {
    return null;
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

// Browser code = anything the bundler ships: src/, public/, index.html. Server code
// (supabase/functions, api/, server/) may hold secrets, so it is not checked for them.
function isBrowserFile(rel) {
  return /^(src|public|app|pages|components)\//.test(rel) || rel === "index.html";
}

export function checkBrowserSecrets(rel, text) {
  const found = [];
  const jwt = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
  for (const m of text.matchAll(jwt)) {
    const role = decodeJwtRole(m[0]);
    if (role === "service_role") {
      found.push({ severity: "high", rule: "service-role-key-in-browser", file: rel, line: lineOf(text, m.index),
        message: "Supabase service_role key in browser code: anyone can read it and bypass every RLS policy. Rotate it and move the work to an Edge Function." });
    } else if (role === "anon") {
      found.push({ severity: "low", rule: "hardcoded-anon-key", file: rel, line: lineOf(text, m.index),
        message: "Supabase anon key hardcoded. It is public by design, but keep it in an env var so each environment (dev, staging, prod) can point at its own project." });
    }
  }
  const secretPatterns = [
    [/sk-ant-[A-Za-z0-9_-]{8,}/g, "Anthropic API key"],
    [/\bsk-(proj-)?[A-Za-z0-9]{20,}/g, "OpenAI API key"],
    [/\bsk_live_[A-Za-z0-9]{10,}/g, "Stripe secret key"],
    [/\bAIza[0-9A-Za-z_-]{30,}/g, "Google API key"],
  ];
  for (const [re, what] of secretPatterns) {
    for (const m of text.matchAll(re)) {
      found.push({ severity: "high", rule: "secret-in-browser", file: rel, line: lineOf(text, m.index),
        message: `${what} in browser code. It ships to every visitor. Rotate it and call the API from a server function.` });
    }
  }
  for (const m of text.matchAll(/(?:import\.meta\.env|process\.env)\.((?:VITE_|NEXT_PUBLIC_|REACT_APP_)[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|ANTHROPIC|OPENAI|STRIPE_SECRET|PRIVATE)[A-Z0-9_]*)/g)) {
    found.push({ severity: "high", rule: "secret-env-exposed", file: rel, line: lineOf(text, m.index),
      message: `${m[1]} is a public env var (the prefix makes the bundler inline it). A secret must never use that prefix.` });
  }
  for (const m of text.matchAll(/api\.(anthropic|openai)\.com/g)) {
    found.push({ severity: "high", rule: "ai-api-called-from-browser", file: rel, line: lineOf(text, m.index),
      message: `Browser code calls ${m[1]} directly, so the key has to be in the browser. Move the call to a server function.` });
  }
  return found;
}

export function checkBrowserCode(rel, text) {
  const found = [];
  for (const m of text.matchAll(/dangerouslySetInnerHTML/g)) {
    found.push({ severity: "medium", rule: "raw-html", file: rel, line: lineOf(text, m.index),
      message: "dangerouslySetInnerHTML renders raw HTML. Fine for trusted constants, an XSS hole for user or AI text." });
  }
  for (const m of text.matchAll(/localStorage\.(?:setItem|getItem)\(\s*["'`](?:role|isAdmin|is_admin|user_role)["'`]/g)) {
    found.push({ severity: "high", rule: "role-in-localstorage", file: rel, line: lineOf(text, m.index),
      message: "Admin role read from localStorage: a user can set it in devtools. Roles must come from the database and be enforced by RLS." });
  }
  return found;
}

// --- SQL migrations ---------------------------------------------------------
function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export function checkMigrations(files) {
  // files: [{ rel, text }] in apply order
  const found = [];
  const tables = new Map(); // name -> { rel, line }
  const rlsOn = new Set();
  const policies = []; // { table, cmd, roles, using, check, rel, line }
  const all = files.map((f) => ({ ...f, sql: stripSqlComments(f.text) }));
  const norm = (n) => n.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();

  for (const { rel, sql } of all) {
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi)) {
      const name = norm(m[1]);
      if (name.includes(".")) continue; // other schemas (auth, storage) are not exposed by the API
      tables.set(name, { rel, line: lineOf(sql, m.index) });
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?([\w."]+)\s+enable\s+row\s+level\s+security/gi)) rlsOn.add(norm(m[1]));
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?([\w."]+)\s+disable\s+row\s+level\s+security/gi)) rlsOn.delete(norm(m[1]));
    const pol = /create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w."]+)([\s\S]*?);/gi;
    for (const m of sql.matchAll(pol)) {
      const body = m[3];
      const cmd = (body.match(/\bfor\s+(all|select|insert|update|delete)\b/i)?.[1] || "all").toLowerCase();
      const roles = (body.match(/\bto\s+([\w\s,]+?)(?=\busing\b|\bwith\b|$)/i)?.[1] || "public").trim().toLowerCase();
      const using = body.match(/\busing\s*\(([\s\S]*?)\)\s*(?:with\b|$)/i)?.[1]?.trim() ?? null;
      const check = body.match(/\bwith\s+check\s*\(([\s\S]*)\)\s*$/i)?.[1]?.trim() ?? null;
      policies.push({ name: m[1], table: norm(m[2]), cmd, roles, using, check, rel, line: lineOf(sql, m.index) });
    }
  }

  for (const [name, at] of tables) {
    if (!rlsOn.has(name)) {
      found.push({ severity: "high", rule: "rls-disabled", file: at.rel, line: at.line,
        message: `Table "${name}" has no row level security. With the public anon key anyone can read and change every row through the API.` });
    }
  }
  const isTrue = (s) => s !== null && /^\(?\s*true\s*\)?$/i.test(s);
  for (const p of policies) {
    const writes = p.cmd !== "select";
    if ((isTrue(p.using) || isTrue(p.check)) && writes) {
      found.push({ severity: "high", rule: "policy-allows-everyone", file: p.rel, line: p.line,
        message: `Policy ${p.name} on "${p.table}" (${p.cmd}) is "true": any caller${p.roles.includes("authenticated") ? " who is signed in" : ""} can change any row. Tie it to auth.uid() or a role check.` });
    } else if (isTrue(p.using) && !p.roles.includes("service_role")) {
      found.push({ severity: "medium", rule: "policy-reads-everything", file: p.rel, line: p.line,
        message: `Policy ${p.name} lets ${p.roles} read every row of "${p.table}". Fine for public data, a leak for anything private.` });
    }
    if (p.cmd === "update" && p.using && !p.check) {
      found.push({ severity: "medium", rule: "update-without-check", file: p.rel, line: p.line,
        message: `Update policy ${p.name} on "${p.table}" has no WITH CHECK, so a user can rewrite a row they own into one they should not (for example change its owner).` });
    }
  }
  // Whole-row UPDATE grant + an "own row" update policy: users can rewrite every column of
  // their row, including ones other people rely on (the email staff see, timestamps, owner ids).
  const SENSITIVE = /^(email|created_at|updated_at|user_id|owner_id|client_id|author_id|role|is_admin|verified|plan|credits|balance)$/i;
  const columns = new Map();
  for (const { sql } of all) {
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(([\s\S]*?)\);/gi)) {
      columns.set(norm(m[1]), m[2].split(/,(?![^(]*\))/).map((c) => c.trim().split(/\s+/)[0].replace(/"/g, "")).filter(Boolean));
    }
  }
  for (const { rel, sql } of all) {
    for (const m of sql.matchAll(/grant\s+([\w\s,]+?)\s+on\s+(?:table\s+)?([\w."]+)\s+to\s+([\w\s,]+?)\s*;/gi)) {
      const privs = m[1].toLowerCase(), table = norm(m[2]), roles = m[3].toLowerCase();
      if (!/\b(update|all)\b/.test(privs) || !/\b(authenticated|anon|public)\b/.test(roles)) continue;
      const ownUpdate = policies.find((p) => p.table === table && (p.cmd === "update" || p.cmd === "all") && /auth\.uid\(\)/.test(`${p.using}`) && !/has_role|is_admin|admin/i.test(`${p.using}`));
      const exposed = (columns.get(table) || []).filter((c) => SENSITIVE.test(c));
      if (ownUpdate && exposed.length) {
        found.push({ severity: "medium", rule: "whole-row-update", file: rel, line: lineOf(sql, m.index),
          message: `Users can update every column of their own "${table}" row, including ${exposed.join(", ")}. Grant UPDATE on the editable columns only.` });
      }
    }
  }
  // SECURITY DEFINER functions run as their owner; Postgres lets everyone (including anon) call
  // a new function unless EXECUTE is revoked.
  for (const { rel, sql } of all) {
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(([^)]*)\)[\s\S]*?security\s+definer/gi)) {
      const fn = m[1].replace(/"/g, "").replace(/^public\./i, "");
      if (/^handle_new_user$/i.test(fn) || /returns\s+trigger/i.test(m[0])) continue;
      const revoked = all.some((f) => new RegExp(`revoke\\s+(?:all|execute)[\\s\\S]*?function\\s+(?:public\\.)?${fn}\\b[\\s\\S]*?from\\s+[^;]*\\b(public|anon)\\b`, "i").test(f.sql));
      if (!revoked) {
        found.push({ severity: "low", rule: "definer-function-callable-by-anyone", file: rel, line: lineOf(sql, m.index),
          message: `SECURITY DEFINER function ${fn}() can be called by anyone, signed in or not (EXECUTE is granted to PUBLIC by default). Revoke it from public and anon.` });
      }
    }
  }
  // A role/is_admin column on a table users can update themselves = self-promotion to admin.
  for (const { rel, sql } of all) {
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(([\s\S]*?)\);/gi)) {
      const name = norm(m[1]);
      if (!/\b(role|is_admin|user_role)\b/i.test(m[2])) continue;
      const selfUpdate = policies.find((p) => p.table === name && (p.cmd === "update" || p.cmd === "all") && /auth\.uid\(\)/.test(`${p.using} ${p.check}`));
      const columnGrant = all.some((f) => new RegExp(`revoke\\s+update[\\s\\S]*?on\\s+(?:table\\s+)?(?:public\\.)?"?${name}"?`, "i").test(f.sql));
      if (selfUpdate && !columnGrant) {
        found.push({ severity: "high", rule: "self-promote-to-admin", file: rel, line: lineOf(sql, m.index),
          message: `"${name}" stores the user's role and policy ${selfUpdate.name} lets users update their own row, so anyone can make themselves admin. Keep roles in a separate table users cannot write.` });
      }
    }
  }
  return found;
}

export function audit(root) {
  const findings = [];
  const files = walk(root).map((p) => ({ abs: p, rel: relative(root, p).split("\\").join("/") }));
  const migrations = [];
  for (const f of files) {
    const ext = extname(f.rel);
    if (/^\.env(\.|$)/.test(f.rel.split("/").pop()) && !/\.example$|\.sample$/.test(f.rel)) {
      findings.push({ severity: "medium", rule: "env-file-committed", file: f.rel, line: 1,
        message: "A .env file is in the repo. Keep real values out of git; commit .env.example instead." });
    }
    // Supabase CLI keeps migrations in supabase/migrations; Lovable Cloud exports keep them in drizzle/migrations.
    if (/^(supabase|drizzle)\/migrations\//.test(f.rel) && ext === ".sql") migrations.push(f);
    if (!CODE_EXT.has(ext) || !isBrowserFile(f.rel)) continue;
    const text = readFileSync(f.abs, "utf8");
    findings.push(...checkBrowserSecrets(f.rel, text), ...checkBrowserCode(f.rel, text));
  }
  migrations.sort((a, b) => a.rel.localeCompare(b.rel));
  findings.push(...checkMigrations(migrations.map((m) => ({ rel: m.rel, text: readFileSync(m.abs, "utf8") }))));
  if (migrations.length && !files.some((f) => /^supabase\/tests\/.*\.sql$/.test(f.rel))) {
    findings.push({ severity: "low", rule: "no-database-tests", file: ".", line: 0,
      message: "The database has security rules but no tests prove them (for example pgTAP in supabase/tests)." });
  }
  if (migrations.some((m) => m.rel.startsWith("drizzle/")) && !migrations.some((m) => m.rel.startsWith("supabase/"))) {
    findings.push({ severity: "medium", rule: "schema-not-in-supabase-migrations", file: "drizzle/migrations", line: 0,
      message: "The schema only exists as a Drizzle export, so `supabase start` / `supabase db push` will not create it. The app cannot run outside the builder's cloud until it moves to supabase/migrations." });
  }
  if (existsSync(join(root, ".gitignore")) && !/^\.env\b/m.test(readFileSync(join(root, ".gitignore"), "utf8"))) {
    findings.push({ severity: "medium", rule: "env-not-gitignored", file: ".gitignore", line: 1,
      message: ".env is not in .gitignore, so keys end up in git history the first time someone commits." });
  }
  if (!files.some((f) => /\.(test|spec)\.[jt]sx?$/.test(f.rel) || /^supabase\/tests\//.test(f.rel))) {
    findings.push({ severity: "low", rule: "no-tests", file: ".", line: 0, message: "No automated tests found." });
  }
  if (!existsSync(join(root, ".github", "workflows"))) {
    findings.push({ severity: "low", rule: "no-ci", file: ".", line: 0, message: "No CI workflow, so nothing checks a change before it ships." });
  }
  return findings.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.file.localeCompare(b.file) || a.line - b.line);
}

export function toMarkdown(findings, root) {
  const n = (s) => findings.filter((f) => f.severity === s).length;
  const lines = [`# Audit of ${root}`, "", `High: ${n("high")}  Medium: ${n("medium")}  Low: ${n("low")}`, ""];
  if (!findings.length) lines.push("Nothing found.");
  for (const f of findings) lines.push(`- **${f.severity.toUpperCase()}** \`${f.rule}\` ${f.file}${f.line ? ":" + f.line : ""}: ${f.message}`);
  return lines.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--")) || ".";
  const failOn = args.includes("--fail-on") ? args[args.indexOf("--fail-on") + 1] : "high";
  const findings = audit(root);
  process.stdout.write(args.includes("--json") ? JSON.stringify(findings, null, 2) + "\n" : toMarkdown(findings, root));
  if (failOn !== "none" && findings.some((f) => RANK[f.severity] >= RANK[failOn])) process.exit(1);
}
