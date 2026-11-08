import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/requests";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
        S
      </span>
      <span className="font-display text-base font-semibold tracking-tight">Studio Desk</span>
    </Link>
  );
}

export function AppHeader() {
  const { user, isAdmin } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-1 text-sm sm:flex">
            <Link
              to="/requests"
              className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground"
              activeProps={{ className: "bg-secondary text-foreground" }}
            >
              My requests
            </Link>
            {isAdmin && (
              <Link
                to="/admin"
                className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                Agency dashboard
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground md:inline">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut /> Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
