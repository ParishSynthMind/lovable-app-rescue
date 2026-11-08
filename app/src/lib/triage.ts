import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type TriageRow = Database["public"]["Tables"]["request_triage"]["Row"];
export type TriagePriority = Database["public"]["Enums"]["triage_priority"];

export const PRIORITY_LABEL: Record<TriagePriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};
export const PRIORITY_VARIANT: Record<TriagePriority, "urgent" | "progress" | "new" | "muted"> = {
  urgent: "urgent",
  high: "progress",
  normal: "new",
  low: "muted",
};
const ORDER: Record<TriagePriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Most urgent first; requests without a triage go last. */
export function byPriority<T extends { triage?: Pick<TriageRow, "priority"> | null | undefined }>(
  a: T,
  b: T,
) {
  return (a.triage ? ORDER[a.triage.priority] : 9) - (b.triage ? ORDER[b.triage.priority] : 9);
}

export const triageKey = ["request-triage"];

/** Every triage row (staff only; RLS returns nothing to clients). */
export function useTriage() {
  return useQuery({
    queryKey: triageKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("request_triage").select("*");
      if (error) throw error;
      return new Map(data.map((t) => [t.request_id, t]));
    },
  });
}

type RunArgs = { request_id: string } | { all_untriaged: true };

/** Calls the triage-request Edge Function. The Claude key lives there, never in the browser. */
export function useRunTriage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RunArgs) => {
      const { data, error } = await supabase.functions.invoke<{
        triaged: { request_id: string }[];
      }>("triage-request", { body });
      if (error) throw new Error("AI triage failed. Try again in a minute.");
      return data?.triaged.length ?? 0;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: triageKey }),
  });
}
