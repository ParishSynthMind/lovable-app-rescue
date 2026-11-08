import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Inbox, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  URGENCY_LABEL,
  formatDate,
  type RequestCategory,
  type RequestRow,
  type RequestUrgency,
} from "@/lib/requests";

export const Route = createFileRoute("/_authenticated/requests")({
  head: () => ({
    meta: [
      { title: "My requests — Studio Desk" },
      { name: "description", content: "Submit and track your requests to the studio." },
      { property: "og:title", content: "My requests — Studio Desk" },
      { property: "og:description", content: "Submit and track your requests to the studio." },
    ],
  }),
  component: RequestsPage,
});

const schema = z.object({
  title: z.string().trim().min(1, "Add a title").max(150),
  description: z.string().trim().min(1, "Add a description").max(5000),
});

function RequestsPage() {
  const qc = useQueryClient();
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["my-requests"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("requests")
        .select("*")
        .eq("client_id", u.user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as RequestRow[];
    },
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<RequestCategory>("change");
  const [urgency, setUrgency] = useState<RequestUrgency>("normal");

  const create = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse({ title, description });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("requests").insert({
        client_id: u.user!.id,
        title: parsed.data.title,
        description: parsed.data.description,
        category,
        urgency,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request sent — we'll be on it soon.");
      setTitle("");
      setDescription("");
      setCategory("change");
      setUrgency("normal");
      qc.invalidateQueries({ queryKey: ["my-requests"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[380px_1fr]">
      <section className="h-fit rounded-xl border bg-card p-6 shadow-card lg:sticky lg:top-24">
        <h2 className="text-lg font-semibold">New request</h2>
        <p className="mt-1 text-sm text-muted-foreground">Tell us what you need.</p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Contact form not sending" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" rows={5} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} placeholder="What happened, where, and what you expected." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as RequestCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Urgency</Label>
              <Select value={urgency} onValueChange={(v) => setUrgency(v as RequestUrgency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(URGENCY_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" variant="brand" className="h-10 w-full" disabled={create.isPending}>
            <Send /> {create.isPending ? "Sending…" : "Submit request"}
          </Button>
        </form>
      </section>

      <section>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold">My requests</h1>
            <p className="mt-1 text-sm text-muted-foreground">{requests.length} total</p>
          </div>
        </div>
        <div className="mt-6 space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : requests.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card p-12 text-center">
              <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-medium">No requests yet</p>
              <p className="text-sm text-muted-foreground">Your submitted requests will show up here.</p>
            </div>
          ) : (
            requests.map((r) => (
              <article key={r.id} className="rounded-xl border bg-card p-5 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="font-semibold">{r.title}</h3>
                  <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{r.description}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="muted">{CATEGORY_LABEL[r.category]}</Badge>
                  <Badge variant={r.urgency === "high" ? "urgent" : "muted"}>{URGENCY_LABEL[r.urgency]} urgency</Badge>
                  <span className="ml-auto">{formatDate(r.created_at)}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
