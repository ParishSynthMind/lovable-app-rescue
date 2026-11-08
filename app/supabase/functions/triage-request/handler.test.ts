import { assertEquals } from "@std/assert";
import {
  BATCH_LIMIT,
  type Caller,
  type Deps,
  handle,
  type StoredRequest,
} from "./handler.ts";
import { FALLBACK, MODEL, type Triage } from "../_shared/triage.ts";

const ID = "6f1c2b9e-2d1a-4c3b-9e8f-0a1b2c3d4e5f";
const row: StoredRequest = {
  id: ID,
  title: "Checkout broken",
  description: "Pay button errors",
  category: "bug",
  urgency: "normal",
};
const result: Triage = {
  summary: "Checkout fails.",
  priority: "urgent",
  reason: "Payments broken.",
  suggested_reply: "On it.",
  needs_review: false,
};

function deps(
  caller: Caller,
  rows: StoredRequest[] = [row],
  t: Triage = result,
) {
  const saved: unknown[] = [];
  const queries: unknown[] = [];
  const d: Deps = {
    whoIs: (h) => Promise.resolve(h ? caller : "anonymous"),
    loadRequests: (
      q,
    ) => (queries.push(q),
      Promise.resolve(q.id ? rows.filter((r) => r.id === q.id) : rows)),
    triage: () => Promise.resolve(t),
    saveTriage: (r) => (saved.push(r), Promise.resolve()),
  };
  return { d, saved, queries };
}
const post = (body: unknown, auth = "Bearer token") =>
  new Request("http://x/triage-request", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

Deno.test("signed out: 401, nothing triaged", async () => {
  const { d, saved } = deps("admin");
  assertEquals((await handle(post({ request_id: ID }, ""), d)).status, 401);
  assertEquals(saved.length, 0);
});

Deno.test("a signed-in client: 403", async () => {
  const { d, saved } = deps("user");
  assertEquals((await handle(post({ request_id: ID }), d)).status, 403);
  assertEquals(saved.length, 0);
});

Deno.test("staff, one request: triaged and saved with the model name", async () => {
  const { d, saved } = deps("admin");
  const res = await handle(post({ request_id: ID }), d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    triaged: [{ request_id: ID, priority: "urgent", needs_review: false }],
  });
  assertEquals(saved, [{ ...result, request_id: ID, model: MODEL }]);
});

Deno.test("staff, unknown id: 404", async () => {
  const { d } = deps("admin", []);
  assertEquals((await handle(post({ request_id: ID }), d)).status, 404);
});

Deno.test("staff, batch: asks for at most the batch limit", async () => {
  const { d, queries, saved } = deps("admin", [
    row,
    { ...row, id: "11111111-1111-4111-8111-111111111111" },
  ]);
  const res = await handle(post({ all_untriaged: true }), d);
  assertEquals(res.status, 200);
  assertEquals(queries, [{ untriagedLimit: BATCH_LIMIT }]);
  assertEquals(saved.length, 2);
});

Deno.test("AI failure is saved as a needs-review row, not dropped", async () => {
  const { d, saved } = deps("admin", [row], FALLBACK);
  const res = await handle(post({ request_id: ID }), d);
  assertEquals((await res.json()).triaged[0].needs_review, true);
  assertEquals((saved[0] as Triage).priority, "high");
});

Deno.test("bad input: not JSON, not a uuid, wrong method; CORS preflight works", async () => {
  const { d } = deps("admin");
  assertEquals((await handle(post("{nope"), d)).status, 400);
  assertEquals(
    (await handle(post({ request_id: "1; drop table requests" }), d)).status,
    400,
  );
  assertEquals(
    (await handle(new Request("http://x", { method: "GET" }), d)).status,
    405,
  );
  assertEquals(
    (await handle(new Request("http://x", { method: "OPTIONS" }), d)).status,
    204,
  );
});
