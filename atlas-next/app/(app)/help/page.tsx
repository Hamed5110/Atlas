"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Activity, Globe, LifeBuoy, Loader2, Search, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { nextHistory, type HelpTurn } from "@/lib/help-history";
import { useT } from "@/lib/i18n";
import { appPath } from "@/lib/paths";

interface GuideSection {
  id: string;
  title: string;
  body: string;
}

interface HelpAnswer {
  answer_id: string | null;
  answer: string;
  searched_web: boolean;
  live_check?: boolean;
  sources: Array<{ title: string; source: string }>;
  citations: Array<{ title: string; url: string }>;
  screens?: Array<{ route: string; title: string }>;
  related?: string[];
}
const SUGGESTION_KEYS = [
  "help.suggest.status",
  "help.suggest.whatsapp",
  "help.suggest.attention",
  "help.suggest.theme",
  "help.suggest.excel",
];

/** **bold** and `code` only — guide text is rendered as React nodes, never as HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="rounded bg-[var(--color-muted)] px-1 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        const heading = lines.length === 1 ? /^#{1,4}\s+(.*)$/.exec(lines[0]) : null;
        if (heading) return <p key={i} className="font-semibold">{inline(heading[1])}</p>;
        if (lines.every((l) => /^\s*(?:[-*•]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]);
          const items = lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*(?:[-*•]|\d+\.)\s+/, ""))}</li>);
          return ordered ? (
            <ol key={i} className="list-decimal space-y-1 ps-5">{items}</ol>
          ) : (
            <ul key={i} className="list-disc space-y-1 ps-5">{items}</ul>
          );
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

function sectionParts(title: string): { chapter: string; heading: string } {
  const parts = title.split(" › ");
  return { chapter: parts[1] ?? parts[0], heading: parts.slice(2).join(" › ") || parts[1] || parts[0] };
}

export default function HelpPage() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<HelpTurn[]>([]);

  const guide = useQuery({
    queryKey: ["help-guide"],
    queryFn: () => api<{ sections: GuideSection[] }>("/help/guide"),
    staleTime: 5 * 60_000,
  });

  const feedback = useMutation({
    mutationFn: (vote: { answer_id: string; helpful: boolean }) =>
      api<{ recorded: boolean; helpful: boolean }>("/help/feedback", { method: "POST", body: vote }),
  });

  const ask = useMutation({
    // Local AI plus a web search can take a while; never leave the button spinning forever.
    mutationFn: (q: string) =>
      api<HelpAnswer>("/help/ask", { method: "POST", body: { question: q, history }, timeoutMs: 150_000 }),
    onMutate: () => feedback.reset(),
    onSuccess: (data, q) => setHistory((prev) => nextHistory(prev, q, data.answer)),
  });

  const sections = useMemo(() => {
    const all = guide.data?.sections ?? [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return all;
    return all.filter((s) => {
      const hay = `${s.title} ${s.body}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  }, [guide.data, query]);

  const chapters = useMemo(() => {
    const order: string[] = [];
    const byChapter = new Map<string, GuideSection[]>();
    for (const s of sections) {
      const { chapter } = sectionParts(s.title);
      if (!byChapter.has(chapter)) {
        byChapter.set(chapter, []);
        order.push(chapter);
      }
      byChapter.get(chapter)!.push(s);
    }
    return order.map((chapter) => ({ chapter, items: byChapter.get(chapter)! }));
  }, [sections]);

  const submit = (text = question) => {
    const q = text.trim();
    if (q.length >= 3 && !ask.isPending) {
      setQuestion(q);
      ask.mutate(q);
    }
  };

  return (
    <div className="animate-[fade-in_0.3s_ease-out] space-y-4" data-testid="help-page">
      <PageHeader title={t("page.help.title")} subtitle={t("page.help.subtitle")} />

      <Card className="border-l-4 border-l-[var(--color-primary)]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <LifeBuoy size={18} className="text-[var(--color-primary)]" />
            {t("help.askTitle")}
          </CardTitle>
          <CardDescription>{t("help.askHintLive")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input
              value={question}
              maxLength={500}
              placeholder={t("help.askPlaceholder")}
              onChange={(e) => setQuestion(e.target.value)}
              data-testid="input-help-question"
            />
            <Button
              type="submit"
              variant="gradient"
              disabled={ask.isPending || question.trim().length < 3}
              data-testid="btn-help-ask"
            >
              {ask.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {t("help.ask")}
            </Button>
          </form>
          {!ask.data && !ask.isPending ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="help-suggestions">
              <span className="text-xs text-[var(--color-muted-foreground)]">{t("help.tryAsking")}</span>
              {SUGGESTION_KEYS.map((key) => (
                <Button key={key} type="button" size="sm" variant="outline" onClick={() => submit(t(key))}>
                  {t(key)}
                </Button>
              ))}
            </div>
          ) : null}
          {ask.isPending ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">{t("help.asking")}</p>
          ) : null}
          {ask.isError ? (
            <p className="text-sm text-[var(--color-destructive)]">{errorMessage(ask.error)}</p>
          ) : null}
          {ask.data ? (
            <div
              className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] p-4"
              data-testid="help-answer"
            >
              <div className="flex flex-wrap gap-2">
                {ask.data.live_check ? (
                  <Badge variant="success" data-testid="help-live-badge">
                    <span className="inline-flex items-center gap-1">
                      <Activity size={12} /> {t("help.checkedLive")}
                    </span>
                  </Badge>
                ) : null}
                <Badge variant={ask.data.searched_web ? "warning" : "info"}>
                  {ask.data.searched_web ? (
                    <span className="inline-flex items-center gap-1">
                      <Globe size={12} /> {t("help.searchedWeb")}
                    </span>
                  ) : (
                    t("help.fromLibrary")
                  )}
                </Badge>
              </div>
              <Markdown text={ask.data.answer} />
              {ask.data.screens?.length ? (
                <div className="flex flex-wrap gap-2" data-testid="help-screen-links">
                  {ask.data.screens.map((s) => (
                    <Link
                      key={s.route}
                      href={appPath(s.route)}
                      className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-muted)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)] lg:min-h-9"
                    >
                      {t("help.openScreen")} {s.title}
                      <ArrowUpRight size={14} className="rtl:-scale-x-100" />
                    </Link>
                  ))}
                </div>
              ) : null}
              {ask.data.related?.length ? (
                <div className="flex flex-wrap gap-2" data-testid="help-related">
                  {ask.data.related.map((r) => (
                    <Button key={r} type="button" size="sm" variant="ghost" onClick={() => submit(r)}>
                      {r}
                    </Button>
                  ))}
                </div>
              ) : null}
              {history.length > 0 ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">{t("help.followUp")}</p>
              ) : null}
              {ask.data.sources.length || ask.data.citations.length ? (
                <div className="space-y-1 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-muted-foreground)]">
                  <p className="font-semibold uppercase tracking-wide">{t("help.sources")}</p>
                  <ul className="space-y-0.5">
                    {ask.data.sources.map((s) => (
                      <li key={s.title}>{s.title}</li>
                    ))}
                    {ask.data.citations.map((c) => (
                      <li key={c.url}>
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--color-primary)] underline"
                        >
                          {c.title || c.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {ask.data.answer_id ? (
                <div
                  className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-2 text-xs"
                  data-testid="help-feedback"
                >
                  {feedback.isSuccess ? (
                    <span className="text-[var(--color-muted-foreground)]" data-testid="help-feedback-thanks">
                      {feedback.data.helpful ? t("help.thanksYes") : t("help.thanksNo")}
                    </span>
                  ) : (
                    <>
                      <span className="text-[var(--color-muted-foreground)]">{t("help.wasHelpful")}</span>
                      {[true, false].map((helpful) => (
                        <Button
                          key={String(helpful)}
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={feedback.isPending}
                          onClick={() => feedback.mutate({ answer_id: ask.data.answer_id!, helpful })}
                          data-testid={helpful ? "help-feedback-yes" : "help-feedback-no"}
                        >
                          {helpful ? <ThumbsUp size={13} /> : <ThumbsDown size={13} />}
                          {helpful ? t("help.yes") : t("help.no")}
                        </Button>
                      ))}
                      {feedback.isError ? (
                        <span className="text-[var(--color-destructive)]">{errorMessage(feedback.error)}</span>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("help.search")}
          className="ps-9"
          data-testid="input-help-search"
        />
      </div>

      {guide.isPending ? (
        <TableSkeleton label={t("state.loading")} />
      ) : guide.isError ? (
        <ErrorState error={guide.error} onRetry={guide.refetch} />
      ) : chapters.length === 0 ? (
        <EmptyState icon={<Search size={22} />} title={t("help.noResults")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Card className="h-fit min-w-0 lg:sticky lg:top-6">
            <CardContent className="p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                {t("help.contents")}
              </p>
              <nav className="space-y-0.5 text-sm">
                {chapters.map(({ chapter }) => (
                  <a
                    key={chapter}
                    href={`#${encodeURIComponent(chapter)}`}
                    className="block truncate rounded px-2 py-1 hover:bg-[var(--color-muted)]"
                  >
                    {chapter}
                  </a>
                ))}
              </nav>
            </CardContent>
          </Card>
          <div className="min-w-0 space-y-4">
            {chapters.map(({ chapter, items }) => (
              <Card key={chapter} id={encodeURIComponent(chapter)} className="scroll-mt-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{chapter}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {items.map((s) => {
                    const { heading } = sectionParts(s.title);
                    return (
                      <section key={s.id} className="space-y-1">
                        {heading !== chapter ? <h3 className="text-sm font-semibold">{heading}</h3> : null}
                        <Markdown text={s.body} />
                      </section>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
