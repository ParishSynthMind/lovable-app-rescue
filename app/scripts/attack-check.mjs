// Tries the same attacks against a running Supabase API as real users, through supabase-js,
// and prints BLOCKED or ALLOWED for each. Used to prove the before/after of the rescue.
//   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... node scripts/attack-check.mjs
// Needs the seed users (supabase/seed.sql). Changes are rolled back where the attack succeeds.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY");
const PASSWORD = "portal-demo-2026";
const STAFF_ID = "00000000-0000-4000-a000-000000000001";

async function as(email) {
  const c = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}
const anon = createClient(url, key, { auth: { persistSession: false } });
const maria = await as("maria@example.com");
const staff = await as("staff@example.com");
const { data: mine } = await maria.from("requests").select("id, description").limit(1);
const mariaId = (await maria.auth.getUser()).data.user.id;

const attacks = [
  ["Client changes the email staff see on the dashboard", async () => {
    const { data, error } = await maria.from("profiles").update({ email: "ceo@bigclient.example" }).eq("id", mariaId).select();
    if (!error && data?.length) await maria.from("profiles").update({ email: "maria@example.com" }).eq("id", mariaId);
    return !error && data?.length > 0;
  }],
  ["Client backdates a request by a year", async () => {
    const { data, error } = await maria.from("requests").insert({ client_id: mariaId, title: "Backdated", description: "x", category: "bug",
      created_at: new Date(Date.now() - 365 * 864e5).toISOString() }).select("id");
    return !error && data?.length > 0;
  }],
  ["Signed-out visitor asks whether a user id is an admin", async () => {
    const { data, error } = await anon.rpc("has_role", { _user_id: STAFF_ID, _role: "admin" });
    return !error && data === true;
  }],
  ["Signed-out visitor lists requests", async () => {
    const { data, error } = await anon.from("requests").select("id");
    return !error && data.length > 0;
  }],
  ["Client reads another client's requests", async () => {
    const { data } = await maria.from("requests").select("id").neq("client_id", mariaId);
    return (data?.length ?? 0) > 0;
  }],
  ["Client reads the internal staff notes", async () => {
    const { data } = await maria.from("request_notes").select("id");
    return (data?.length ?? 0) > 0;
  }],
  ["Client makes herself admin", async () => {
    const { error } = await maria.from("user_roles").insert({ user_id: mariaId, role: "admin" });
    return !error;
  }],
  ["Client marks her own request done", async () => {
    const { data } = await maria.from("requests").update({ status: "done" }).eq("id", mine[0].id).select();
    return (data?.length ?? 0) > 0;
  }],
  ["Staff rewrite what the client wrote", async () => {
    const { data, error } = await staff.from("requests").update({ description: "rewritten by staff" }).eq("id", mine[0].id).select();
    if (!error && data?.length) await staff.from("requests").update({ description: mine[0].description }).eq("id", mine[0].id);
    return !error && data?.length > 0;
  }],
];

let allowed = 0;
for (const [name, run] of attacks) {
  const ok = await run();
  allowed += ok ? 1 : 0;
  console.log(`${ok ? "ALLOWED" : "BLOCKED"}  ${name}`);
}
console.log(`\n${attacks.length - allowed} of ${attacks.length} blocked`);
process.exitCode = allowed ? 1 : 0;
