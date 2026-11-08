// Request handling for the triage-request function, with its outside world passed in,
// so the tests can run every path without Supabase or Claude.
import { MODEL, type RequestInput, type Triage } from "../_shared/triage.ts";

export type Caller = "anonymous" | "user" | "admin";
export interface StoredRequest extends RequestInput {
  id: string;
}
export interface Deps {
  whoIs(authHeader: string | null): Promise<Caller>;
  loadRequests(
    q: { id?: string; untriagedLimit?: number },
  ): Promise<StoredRequest[]>;
  triage(r: RequestInput): Promise<Triage>;
  saveTriage(
    row: Triage & { request_id: string; model: string },
  ): Promise<void>;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BATCH_LIMIT = 10;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const caller = await deps.whoIs(req.headers.get("Authorization"));
  if (caller === "anonymous") return json(401, { error: "Sign in first" });
  if (caller !== "admin") return json(403, { error: "Agency staff only" });

  let body: { request_id?: unknown; all_untriaged?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Body must be JSON" });
  }
  let rows: StoredRequest[];
  if (typeof body.request_id === "string" && UUID.test(body.request_id)) {
    rows = await deps.loadRequests({ id: body.request_id });
    if (!rows.length) return json(404, { error: "No such request" });
  } else if (body.all_untriaged === true) {
    rows = await deps.loadRequests({ untriagedLimit: BATCH_LIMIT });
  } else {
    return json(400, {
      error: "Send request_id (uuid) or all_untriaged: true",
    });
  }

  const results = [];
  for (const r of rows) {
    const t = await deps.triage(r);
    await deps.saveTriage({ ...t, request_id: r.id, model: MODEL });
    results.push({
      request_id: r.id,
      priority: t.priority,
      needs_review: t.needs_review,
    });
  }
  return json(200, { triaged: results });
}
