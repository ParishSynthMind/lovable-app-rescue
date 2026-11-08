import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Lock, ShieldAlert, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  URGENCY_LABEL,
  formatDate,
  useCurrentUser,
  type RequestRow,
  type RequestStatus,
} from "@/lib/requests";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Agency dashboard — Studio Desk" },
      { name: "description", content: "Every client request in one place." },
      { property: "og:title", content: "Agency dashboard — Studio Desk" },
      { property: "og:description", content: "Every client request in one place." },
    ],
  }),
  component: AdminPage,
});

type AdminRequest = RequestRow & { profiles: { email: string; full_name: string | null } | null };
const FILTERS: Array<RequestStatus | "all"> = ["all", "new", "in_progress", "done"];

function AdminPage() {
  const { isAdmin, loading } = useCurrentUser();
  if (loading) return <p className="p-10 text-sm text-muted-foreground">Loading…</p>;
  if (!isAdmin)
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">Agency staff only</h1>
        <p className="mt-2 text-sm text-muted-foreground">This dashboard is for agency admins.</p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/requests">Go to my requests</Link>
        </Button>
      </div>
    );
  return <Dashboard />;
}

function Dashboard() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<RequestStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: all = [], isLoading } = useQuery({
    queryKey: ["admin-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("requests")
        .select("*, profiles(email, full_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AdminRequest[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RequestStatus }) => {
      const { error } = await supabase.from("requests").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["admin-requests"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const counts = {
    all: all.length,
    new: all.filter((r) => r.status === "new").length,
    in_progress: all.filter((r) => r.status === "in_progress").length,
    done: all.filter((r) => r.status === "done").length,
  };
  const rows = filter === "all" ? all : all.filter((r) => r.status === filter);
  const open = all.find((r) => r.id === openId) ?? null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Agency dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every request from every client.</p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-xl border bg-card p-4 text-left shadow-card transition",
              filter === f ? "border-brand ring-1 ring-brand" : "hover:border-foreground/20",
            )}
          >
            <div className="text-xs font-medium text-muted-foreground">
              {f === "all" ? "All requests" : STATUS_LABEL[f]}
            </div>
            <div className="mt-1 font-display text-2xl font-semibold">{counts[f]}</div>
          </button>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-secondary/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Request</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Client</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">Urgency</th>
              <th className="hidden px-4 py-3 font-medium lg:table-cell">Submitted</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No requests here.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <button className="text-left" onClick={() => setOpenId(r.id)}>
                      <div className="font-medium hover:underline">{r.title}</div>
                      <div className="text-xs text-muted-foreground">{CATEGORY_LABEL[r.category]}</div>
                    </button>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <div>{r.profiles?.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.profiles?.email}</div>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <Badge variant={r.urgency === "high" ? "urgent" : "muted"}>{URGENCY_LABEL[r.urgency]}</Badge>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{formatDate(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <StatusSelect value={r.status} onChange={(status) => setStatus.mutate({ id: r.id, status })} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle className="pr-6 font-display">{open.title}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant={STATUS_VARIANT[open.status]}>{STATUS_LABEL[open.status]}</Badge>
                <Badge variant="muted">{CATEGORY_LABEL[open.category]}</Badge>
                <Badge variant={open.urgency === "high" ? "urgent" : "muted"}>{URGENCY_LABEL[open.urgency]} urgency</Badge>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                From {open.profiles?.full_name || open.profiles?.email} · {formatDate(open.created_at)}
              </p>
              <p className="mt-4 whitespace-pre-wrap text-sm">{open.description}</p>
              <div className="mt-6">
                <StatusSelect value={open.status} onChange={(status) => setStatus.mutate({ id: open.id, status })} />
              </div>
              <Notes requestId={open.id} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}

function StatusSelect({ value, onChange }: { value: RequestStatus; onChange: (s: RequestStatus) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RequestStatus)}>
      <SelectTrigger className="h-8 w-[140px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(STATUS_LABEL) as RequestStatus[]).map((s) => (
          <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Notes({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const key = ["notes", requestId];
  const { data: notes = [] } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("request_notes")
        .select("*")
        .eq("request_id", requestId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const text = body.trim();
      if (!text) throw new Error("Write a note first");
      if (text.length > 5000) throw new Error("Note is too long");
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("request_notes").insert({ request_id: requestId, body: text, author_id: u.user!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("request_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <section className="mt-8 rounded-xl border bg-secondary/50 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Lock className="h-3.5 w-3.5" /> Internal notes
      </h3>
      <p className="text-xs text-muted-foreground">Only agency staff can see these.</p>
      <div className="mt-4 space-y-2">
        {notes.map((n) => (
          <div key={n.id} className="group rounded-lg border bg-card p-3 text-sm">
            <p className="whitespace-pre-wrap">{n.body}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{new Date(n.created_at).toLocaleString()}</span>
              <button aria-label="Delete note" className="opacity-0 transition group-hover:opacity-100" onClick={() => remove.mutate(n.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <Textarea className="mt-3 bg-card" rows={3} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for the team…" />
      <Button size="sm" className="mt-2" onClick={() => add.mutate()} disabled={add.isPending}>
        Add note
      </Button>
    </section>
  );
}
