"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { appPath } from "@/lib/paths";
import { cn } from "@/lib/utils";

export interface WorkItem {
  id: string;
  kind: string;
  severity: "danger" | "warning" | "info";
  due: string | null;
  days: number | null;
  href: string;
  employee_code: string;
  employee_name: string;
  document: string | null;
}

export interface WorkInboxResult {
  as_of: string;
  total: number;
  truncated: boolean;
  counts: { danger: number; warning: number; info: number };
  items: WorkItem[];
}

const TONE: Record<WorkItem["severity"], string> = {
  danger: "bg-[var(--color-destructive)]",
  warning: "bg-[var(--color-warning)]",
  info: "bg-[var(--color-primary)]",
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

export function workItemText(
  item: WorkItem,
  t: (key: string) => string,
  formatDate: (value: string) => string
): string {
  const date = item.due ? formatDate(item.due) : "";
  const values = {
    name: item.employee_name || item.employee_code,
    date,
    doc: item.document ? t(`work.doc.${item.document}`) : "",
  };
  const key: Record<string, string> = {
    document_expired: "work.docExpired",
    document_due: "work.docDue",
    ess_review: "work.essReview",
    ess_ready: "work.essReady",
    ess_waiting: "work.essWaiting",
    ticket_review: "work.ticketReview",
    leave_overdue: "work.leaveOverdue",
    leave_due: "work.leaveDue",
    loan_overdue: "work.loanOverdue",
    loan_due: "work.loanDue",
  };
  return fill(t(key[item.kind] ?? item.kind), values);
}

function openHref(href: string): string {
  const hashAt = href.indexOf("#");
  if (hashAt === -1) return appPath(href);
  return `${appPath(href.slice(0, hashAt))}#${href.slice(hashAt + 1)}`;
}

/** The day's actionable work: reviews, expiring documents, overdue leave, loan instalments. */
export function WorkInbox() {
  const t = useT();
  const router = useRouter();
  const query = useQuery({
    queryKey: ["work-inbox"],
    queryFn: () => api<WorkInboxResult>("/work"),
    refetchInterval: 60_000,
    retry: false,
  });

  if (query.isError && query.error instanceof ApiError && query.error.status === 404) return null;

  const items = query.data?.items ?? [];
  const danger = query.data?.counts.danger ?? 0;

  return (
    <Card className="mt-6" data-testid="work-inbox">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{t("work.title")}</CardTitle>
            <CardDescription>{t("work.subtitle")}</CardDescription>
          </div>
          {danger > 0 ? (
            <Badge variant="destructive" data-testid="work-inbox-danger">
              <CircleAlert size={12} /> {danger}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("state.loading")}</p>
        ) : query.isError ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t("work.unavailable")}{" "}
            <button type="button" className="underline" onClick={() => void query.refetch()}>
              {t("work.retry")}
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]" data-testid="work-inbox-empty">
            <CircleCheck size={15} /> {t("work.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-testid={`work-item-${item.kind}`}
                  onClick={() => router.push(openHref(item.href))}
                  className="flex w-full items-center gap-3 py-2 text-left text-sm hover:text-[var(--color-primary)]"
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE[item.severity])} />
                  <span className="min-w-0 flex-1 truncate">
                    {workItemText(item, t, (value) => fmtDate(value))}
                  </span>
                  {item.employee_code ? (
                    <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                      {item.employee_code}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
