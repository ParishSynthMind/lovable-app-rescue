// Live check of the triage-request Edge Function on a running stack (local or hosted).
//   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... node scripts/live-triage.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_PUBLISHABLE_KEY;
const client = () => createClient(url, key, { auth: { persistSession: false } });
async function as(email) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password: "portal-demo-2026" });
  if (error) throw error;
  return c;
}
const status = async (p) => {
  const { error } = await p;
  return error?.context?.status ?? (error ? "error" : 200);
};

console.log(
  "signed out ->",
  await status(client().functions.invoke("triage-request", { body: { all_untriaged: true } })),
);
const maria = await as("maria@example.com");
console.log(
  "client (maria) ->",
  await status(maria.functions.invoke("triage-request", { body: { all_untriaged: true } })),
);

const staff = await as("staff@example.com");
const t0 = Date.now();
const { data, error } = await staff.functions.invoke("triage-request", {
  body: { all_untriaged: true },
});
if (error) throw error;
console.log(
  `staff -> 200, ${data.triaged.length} requests triaged in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`,
);

const { data: rows } = await staff
  .from("requests")
  .select(
    "title, urgency, request_triage(priority, reason, summary, suggested_reply, needs_review, model)",
  )
  .order("created_at");
for (const r of rows) {
  const t = r.request_triage;
  if (!t) continue;
  console.log(`${r.title}  (client said: ${r.urgency})`);
  console.log(
    `  AI priority: ${t.priority}${t.needs_review ? "  NEEDS REVIEW" : ""}   model: ${t.model}`,
  );
  console.log(`  why: ${t.reason}`);
  console.log(`  summary: ${t.summary}`);
  console.log(`  draft reply: ${t.suggested_reply}\n`);
}
const { data: leak } = await maria.from("request_triage").select("*");
console.log("client reading request_triage afterwards ->", leak?.length ?? 0, "rows");
