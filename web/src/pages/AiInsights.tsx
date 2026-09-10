import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BrainCircuit,
  CircleCheck,
  Loader2,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Wrench,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmtDateTime, forecastMonthLabel, money, num, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BudgetForecast, DiagnoseResult, LearningStats } from "@/lib/types";

const SEVERITY_STYLE: Record<string, { ring: string; badge: "destructive" | "warning" | "info" }> = {
  critical: { ring: "border-l-[var(--color-destructive)]", badge: "destructive" },
  warning: { ring: "border-l-[var(--color-warning)]", badge: "warning" },
  info: { ring: "border-l-[var(--color-info)]", badge: "info" },
};

export function AiInsightsPage() {
  const queryClient = useQueryClient();

  const learning = useQuery({
    queryKey: ["ai-learning"],
    queryFn: () => api<LearningStats>("/ai/support/learning"),
  });
  const forecast = useQuery({
    queryKey: ["forecast-budget"],
    queryFn: () => api<BudgetForecast>("/ai/forecasts/budget"),
  });

  const diagnoseMutation = useMutation({
    mutationFn: () => api<DiagnoseResult>("/ai/support/diagnose"),
    onError: (err) => toast.error("Diagnostics failed", err instanceof Error ? err.message : undefined),
  });

  const remediateMutation = useMutation({
    mutationFn: (checkCode: string) =>
      api<{ outcome: string; fixed: number; verified: boolean }>("/ai/support/remediate", {
        method: "POST",
        body: { check_code: checkCode },
      }),
    onSuccess: (result, checkCode) => {
      toast[result.outcome === "success" ? "success" : "warning"](
        `Fix ${result.outcome}`,
        `${result.fixed} record(s) corrected for ${checkCode}; verification ${result.verified ? "passed" : "failed"}.`
      );
      queryClient.invalidateQueries({ queryKey: ["ai-learning"] });
      diagnoseMutation.mutate();
    },
    onError: (err) => toast.error("Remediation failed", err instanceof Error ? err.message : undefined),
  });

  const feedbackMutation = useMutation({
    mutationFn: ({ checkCode, worked }: { checkCode: string; worked: boolean }) =>
      api("/ai/support/feedback", { method: "POST", body: { check_code: checkCode, worked } }),
    onSuccess: () => {
      toast.success("Feedback recorded", "The learning store updated confidence scores.");
      queryClient.invalidateQueries({ queryKey: ["ai-learning"] });
    },
    onError: (err) => toast.error("Feedback failed", err instanceof Error ? err.message : undefined),
  });

  const findings = diagnoseMutation.data?.findings ?? [];
  const healthy = diagnoseMutation.data?.healthy;
  const stats = learning.data;
  const points = (forecast.data?.forecast ?? []).map((p) => ({
    month: forecastMonthLabel(p.month),
    projected: Number(p.amount),
    band: [Number(p.low ?? p.amount), Number(p.high ?? p.amount)] as [number, number],
  }));

  const outcomeEntries = Object.entries(stats?.by_outcome ?? {});
  const successRate = (() => {
    const success = Number(stats?.by_outcome?.success ?? 0);
    const failed = Number(stats?.by_outcome?.failed ?? 0);
    return success + failed > 0 ? Math.round((success / (success + failed)) * 100) : null;
  })();

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="AI Insights"
        subtitle="Self-diagnosing, self-healing checks with a learning feedback loop"
        actions={
          <Button
            variant="gradient"
            disabled={diagnoseMutation.isPending}
            onClick={() => diagnoseMutation.mutate()}
          >
            {diagnoseMutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sparkles size={15} />
            )}
            Run diagnostics
          </Button>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Learning events" value={num(stats?.total_events ?? 0)} icon={<BrainCircuit size={20} />} tone="primary" />
        <StatCard
          label="Fix success rate"
          value={successRate == null ? "—" : `${successRate}%`}
          hint="From recorded outcomes"
          icon={<CircleCheck size={20} />}
          tone="success"
        />
        <StatCard
          label="Forecast horizon"
          value={points.length ? `${points.length} mo` : "—"}
          icon={<TrendingUp size={20} />}
          tone="accent"
        />
        <StatCard
          label="System health"
          value={healthy == null ? "—" : healthy ? "Healthy" : "Attention"}
          icon={<ShieldCheck size={20} />}
          tone={healthy === false ? "destructive" : "success"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Diagnostics</CardTitle>
            <CardDescription>
              {diagnoseMutation.data
                ? `Last run ${fmtDateTime(diagnoseMutation.data.ran_at)}`
                : "Run diagnostics to scan data quality, configuration, and security"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!diagnoseMutation.data ? (
              <EmptyState
                icon={<Activity size={22} />}
                title="No scan yet"
                message="Diagnostics check employees, loans, rates, sessions, and user security — then propose safe fixes."
              />
            ) : findings.length === 0 ? (
              <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[hsl(142_71%_39%/0.35)] bg-[hsl(142_71%_96%)] p-4">
                <CircleCheck size={20} className="text-[var(--color-success)]" />
                <div>
                  <p className="text-sm font-bold text-[hsl(142_71%_28%)]">All clear</p>
                  <p className="text-xs text-[hsl(142_71%_35%)]">Every check passed. Nothing needs attention.</p>
                </div>
              </div>
            ) : (
              findings.map((f) => {
                const style = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.info;
                return (
                  <div
                    key={f.check_code}
                    className={cn(
                      "rounded-[var(--radius-md)] border border-[var(--color-border)] border-l-4 bg-white p-4 shadow-[var(--shadow-card)]",
                      style.ring
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={style.badge}>{titleCase(String(f.severity))}</Badge>
                          <span className="text-[11px] font-mono text-[var(--color-muted-foreground)]">
                            {f.check_code}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm font-bold">{f.summary}</p>
                        <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{f.suggestion}</p>
                      </div>
                      <div className="text-right text-[11px] text-[var(--color-muted-foreground)]">
                        <p>confidence {Math.round(Number(f.confidence ?? 0) * 100)}%</p>
                        <p>
                          {f.learned_success_rate == null
                            ? "no history yet"
                            : `${Math.round(Number(f.learned_success_rate) * 100)}% past fix success`}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
                      {f.auto_fixable ? (
                        <Button
                          size="sm"
                          disabled={remediateMutation.isPending}
                          onClick={() => remediateMutation.mutate(f.check_code)}
                        >
                          <Wrench size={13} /> Apply fix
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={feedbackMutation.isPending}
                        onClick={() => feedbackMutation.mutate({ checkCode: f.check_code, worked: true })}
                      >
                        <ThumbsUp size={13} /> Worked
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={feedbackMutation.isPending}
                        onClick={() => feedbackMutation.mutate({ checkCode: f.check_code, worked: false })}
                      >
                        <ThumbsDown size={13} /> Didn't work
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Budget forecast</CardTitle>
              <CardDescription>AI-projected monthly airfare spend</CardDescription>
            </CardHeader>
            <CardContent>
              {forecast.isPending ? (
                <div className="h-48 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-secondary)]" />
              ) : points.length ? (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                      <defs>
                        <linearGradient id="aiForecastFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(262 83% 58%)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="hsl(243 75% 59%)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 91%)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(220 9% 46%)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(220 9% 46%)" }} axisLine={false} tickLine={false} width={54} />
                      <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid hsl(220 13% 91%)" }} />
                      <Area type="monotone" dataKey="band" stroke="none" fill="hsl(262 83% 58%)" fillOpacity={0.1} />
                      <Area type="monotone" dataKey="projected" stroke="hsl(262 83% 58%)" strokeWidth={2.5} fill="url(#aiForecastFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  Not enough history to forecast yet.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Learning store</CardTitle>
              <CardDescription>What the system has learned from outcomes</CardDescription>
            </CardHeader>
            <CardContent>
              {learning.isPending ? (
                <TableSkeleton rows={3} />
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {outcomeEntries.length ? (
                      outcomeEntries.map(([outcome, count]) => (
                        <Badge key={outcome} variant={outcome === "success" ? "success" : outcome === "failed" ? "destructive" : "secondary"}>
                          {titleCase(outcome)}: {num(count)}
                        </Badge>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--color-muted-foreground)]">No events recorded yet.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    {(stats?.recent ?? []).slice(0, 6).map((event) => (
                      <div key={event.id} className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--color-secondary)] px-3 py-2">
                        <Badge variant={event.outcome === "success" ? "success" : event.outcome === "failed" ? "destructive" : "info"} className="mt-0.5 shrink-0">
                          {titleCase(event.event_type)}
                        </Badge>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">{event.summary}</p>
                          <p className="text-[11px] text-[var(--color-muted-foreground)]">
                            {event.check_code} · {fmtDateTime(event.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
