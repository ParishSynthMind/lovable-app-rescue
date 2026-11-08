import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TriagePanel } from "@/components/TriagePanel";
import { byPriority, PRIORITY_LABEL, PRIORITY_VARIANT, type TriageRow } from "@/lib/triage";

const ID = "6f1c2b9e-2d1a-4c3b-9e8f-0a1b2c3d4e5f";
const row = (over: Partial<TriageRow> = {}): TriageRow => ({
  request_id: ID,
  priority: "urgent",
  reason: "Payments are broken on the live site.",
  summary: "Checkout fails at the payment step.",
  suggested_reply: "Thanks, we are on it.",
  needs_review: false,
  model: "claude-sonnet-5-5",
  created_at: "2026-11-08T12:00:00Z",
  ...over,
});
function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => invoke.mockReset());

describe("TriagePanel", () => {
  it("offers to triage when there is no result yet", () => {
    wrap(<TriagePanel requestId={ID} triage={undefined} />);
    expect(screen.getByRole("button", { name: "Triage with Claude" })).toBeInTheDocument();
  });

  it("calls the Edge Function with this request's id, never the Claude API directly", async () => {
    invoke.mockResolvedValue({ data: { triaged: [{ request_id: ID }] }, error: null });
    wrap(<TriagePanel requestId={ID} triage={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Triage with Claude" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("triage-request", { body: { request_id: ID } }),
    );
  });

  it("shows priority, reason, summary and the draft reply", () => {
    wrap(<TriagePanel requestId={ID} triage={row()} />);
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByText("Payments are broken on the live site.")).toBeInTheDocument();
    expect(screen.getByText("Thanks, we are on it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
  });

  it("renders AI text as text: HTML in it never becomes elements", () => {
    const evil = '<img src=x onerror="alert(1)"><b>bold</b>';
    const { container } = wrap(
      <TriagePanel requestId={ID} triage={row({ summary: evil, suggested_reply: evil })} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getAllByText(evil)).toHaveLength(2);
  });

  it("a failed AI run is shown as 'needs a person', not as a priority", () => {
    wrap(
      <TriagePanel
        requestId={ID}
        triage={row({ needs_review: true, priority: "high", summary: "" })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Needs a person");
  });
});

describe("priority helpers", () => {
  it("sorts urgent first and untriaged last", () => {
    const items = [
      { id: "a" },
      { id: "b", triage: row({ priority: "low" }) },
      { id: "c", triage: row({ priority: "urgent" }) },
      { id: "d", triage: row({ priority: "high" }) },
    ];
    expect(items.sort(byPriority).map((i) => i.id)).toEqual(["c", "d", "b", "a"]);
  });
  it("has a label and badge for every priority the database allows", () => {
    for (const p of ["low", "normal", "high", "urgent"] as const) {
      expect(PRIORITY_LABEL[p]).toBeTruthy();
      expect(PRIORITY_VARIANT[p]).toBeTruthy();
    }
  });
});
