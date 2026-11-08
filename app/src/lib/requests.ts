import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type RequestRow = Database["public"]["Tables"]["requests"]["Row"];
export type RequestStatus = Database["public"]["Enums"]["request_status"];
export type RequestCategory = Database["public"]["Enums"]["request_category"];
export type RequestUrgency = Database["public"]["Enums"]["request_urgency"];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
};
export const STATUS_VARIANT: Record<RequestStatus, "new" | "progress" | "done"> = {
  new: "new",
  in_progress: "progress",
  done: "done",
};
export const CATEGORY_LABEL: Record<RequestCategory, string> = {
  bug: "Bug",
  change: "Change",
  question: "Question",
};
export const URGENCY_LABEL: Record<RequestUrgency, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Current user + whether they hold the admin role (checked against the database). */
export function useCurrentUser() {
  const [state, setState] = useState<{ user: User | null; isAdmin: boolean; loading: boolean }>({
    user: null,
    isAdmin: false,
    loading: true,
  });
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      let isAdmin = false;
      if (user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin");
        isAdmin = (roles?.length ?? 0) > 0;
      }
      if (active) setState({ user, isAdmin, loading: false });
    })();
    return () => {
      active = false;
    };
  }, []);
  return state;
}

export async function getHomePath(): Promise<"/admin" | "/requests"> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return "/requests";
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin");
  return (roles?.length ?? 0) > 0 ? "/admin" : "/requests";
}
