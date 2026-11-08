import { useState } from "react";
import { toast } from "sonner";
import { Copy, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PRIORITY_LABEL, PRIORITY_VARIANT, useRunTriage, type TriageRow } from "@/lib/triage";

/** Claude's read of one request: priority and why, a summary, and a draft reply staff can copy.
 *  Everything is rendered as plain text, never as HTML, because it comes from the client's words. */
export function TriagePanel({
  requestId,
  triage,
}: {
  requestId: string;
  triage: TriageRow | undefined;
}) {
  const run = useRunTriage();
  const [copied, setCopied] = useState(false);

  const start = () =>
    run.mutate({ request_id: requestId }, { onError: (e) => toast.error(e.message) });

  const copy = async () => {
    if (!triage) return;
    await navigator.clipboard.writeText(triage.suggested_reply);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section aria-label="AI triage" className="mt-8 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-3.5 w-3.5" /> AI triage
        </h3>
        <Button size="sm" variant="outline" onClick={start} disabled={run.isPending}>
          {run.isPending ? "Asking Claude…" : triage ? "Run again" : "Triage with Claude"}
        </Button>
      </div>

      {!triage ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Claude suggests a priority, sums the request up and drafts a first reply. Staff only.
        </p>
      ) : triage.needs_review ? (
        <p className="mt-3 text-sm" role="alert">
          <Badge variant="urgent">Needs a person</Badge> The AI could not give a usable answer, so
          this was flagged as high priority for review.
        </p>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={PRIORITY_VARIANT[triage.priority]}>
              {PRIORITY_LABEL[triage.priority]}
            </Badge>
            <span className="text-muted-foreground">{triage.reason}</span>
          </div>
          <p>{triage.summary}</p>
          <div className="rounded-lg border bg-secondary/50 p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Draft reply (check before sending)</span>
              <button className="flex items-center gap-1 hover:text-foreground" onClick={copy}>
                <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="whitespace-pre-wrap">{triage.suggested_reply}</p>
          </div>
        </div>
      )}
    </section>
  );
}
