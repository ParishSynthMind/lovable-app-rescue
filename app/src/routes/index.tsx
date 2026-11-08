import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Bug, MessageCircleQuestion, PencilRuler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/AppHeader";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Studio Desk — Client Request Portal" },
      {
        name: "description",
        content:
          "Submit bugs, change requests and questions to your web design studio and track their status.",
      },
      { property: "og:title", content: "Studio Desk — Client Request Portal" },
      {
        property: "og:description",
        content:
          "Submit bugs, change requests and questions to your web design studio and track their status.",
      },
    ],
  }),
  component: Index,
});

const items = [
  {
    icon: Bug,
    title: "Report a bug",
    text: "Something broken on your site? Tell us and we'll fix it.",
  },
  {
    icon: PencilRuler,
    title: "Request a change",
    text: "New copy, a fresh section, a tweak to the layout.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Ask a question",
    text: "Anything about your site, hosting or next steps.",
  },
];

function Index() {
  return (
    <div className="min-h-screen bg-hero">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <Button asChild variant="ghost" size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-20">
        <span className="inline-flex items-center rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          Client portal
        </span>
        <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.05] sm:text-6xl">
          Your requests, handled <span className="text-brand">without the email chains.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Send us what you need, and see exactly where it stands — new, in progress or done.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild size="lg" className="h-11">
            <Link to="/auth">
              Get started <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="mt-24 grid gap-4 sm:grid-cols-3">
          {items.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border bg-card p-6 shadow-card">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
