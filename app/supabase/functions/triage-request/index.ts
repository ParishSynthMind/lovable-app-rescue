// Supabase Edge Function: Claude triage for client requests. Staff only.
//   POST { "request_id": "<uuid>" }       triage one request (again)
//   POST { "all_untriaged": true }         triage up to 10 requests that have none yet
// Secrets: ANTHROPIC_API_KEY (supabase secrets set). SUPABASE_* are provided by the platform.
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { triage } from "../_shared/triage.ts";
import { type Caller, handle, type StoredRequest } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const COLUMNS = "id, title, description, category, urgency";

Deno.serve((req) =>
  handle(req, {
    async whoIs(authHeader): Promise<Caller> {
      if (!authHeader?.startsWith("Bearer ")) return "anonymous";
      // Ask the database as the caller, so the answer comes from their own JWT.
      const asCaller = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: u } = await asCaller.auth.getUser(authHeader.slice(7));
      if (!u.user) return "anonymous";
      const { data: isAdmin, error } = await asCaller.rpc("has_role", {
        _user_id: u.user.id,
        _role: "admin",
      });
      if (error) throw error;
      return isAdmin === true ? "admin" : "user";
    },
    async loadRequests({ id, untriagedLimit }): Promise<StoredRequest[]> {
      if (id) {
        const { data, error } = await admin.from("requests").select(COLUMNS).eq(
          "id",
          id,
        );
        if (error) throw error;
        return data;
      }
      const { data, error } = await admin
        .from("requests")
        .select(`${COLUMNS}, request_triage(request_id)`)
        .is("request_triage", null)
        .neq("status", "done")
        .order("created_at")
        .limit(untriagedLimit ?? 10);
      if (error) throw error;
      return data.map(({ request_triage: _, ...r }) => r);
    },
    triage: (r) => triage(anthropic, r),
    async saveTriage(row) {
      const { error } = await admin
        .from("request_triage")
        .upsert({ ...row, created_at: new Date().toISOString() });
      if (error) throw error;
    },
  }).catch((e) => {
    console.error("triage-request failed", e);
    return new Response(JSON.stringify({ error: "Triage failed, try again" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  })
);
