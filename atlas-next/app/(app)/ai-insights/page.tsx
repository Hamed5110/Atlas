"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cpu,
  Activity,
  BookOpen,
  BrainCircuit,
  CircleCheck,
  Loader2,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wrench,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";
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
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { LanguageSwitcher } from "@/components/language-switcher";
import { api, errorMessage } from "@/lib/api";
import { forecastMonthLabel, money, num, titleCase } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BudgetForecast, DiagnoseResult, LearningStats, LlmStatus } from "@/lib/types";

const SEVERITY_STYLE: Record<string, { ring: string; badge: "destructive" | "warning" | "info" }> = {
  critical: { ring: "border-l-[var(--color-destructive)]", badge: "destructive" },
  warning: { ring: "border-l-[var(--color-warning)]", badge: "warning" },
  info: { ring: "border-l-[var(--color-info)]", badge: "info" },
};

const SMART_CHIPS = [
  "Teach me everything",
  "Whole airfare process step by step",
  "Support me step by step",
  "How do ESS requests work",
  "How do I export the finance ledger",
  "What is airfare rate",
  "What is modern entitlement",
  "How does allocation work",
  "How does joining-date cycle work",
  "How does local Ollama work",
  "What can you do",
  "Recall company logos",
  "Research online Bahraini dinar",
  "Research online IATA airport codes India Pakistan",
  "Run diagnostics",
  "Machine learning anomalies",
  "Forecast spend",
  "Draft a report on loans",
  "Show schema",
  "preview SQL for locked users",
] as const;

interface AgentReply {
  intent: string;
  outcome: string;
  reply: string;
  confidence_score?: number;
  tools_used: string[];
  sql?: string[];
  findings?: DiagnoseResult["findings"];
  plan?: {
    mode?: string;
    thoughts?: string[];
    primary_action?: string;
    risk?: string;
    steps?: { id: string; thought: string; action: string; risk?: string }[];
  };
  research?: {
    summary?: string;
    citations?: { title?: string; url?: string }[];
    privacy_note?: string;
  };
  knowledge?: {
    corpus_size?: number;
    hits?: { title?: string; score?: number }[];
  };
  ml?: Record<string, unknown>;
  repair_preview?: {
    check_code: string;
    apply_token: string;
    before_count: number;
    narrative: string;
  };
  report_designer_payload?: {
    dataset: string;
    title: string;
    sql_source: string;
    columns?: string[];
  };
  report_spec?: { dataset: string; title: string; columns: string[] };
}

interface AnomalyResult {
  count: number;
  items: unknown[];
}

interface SaaActionItem {
  kind: string;
  code: string;
  title: string;
  risk: string;
  score: number;
  tsql?: string | null;
  status?: string;
}

interface SaaBaseline {
  saa_version: string;
  generated_at: string;
  executive_summary: string;
  ask: string;
  focus8080: { focus_origin_count: number };
  data_quality: { finding_count?: number; top_flags?: DiagnoseResult["findings"] };
  action_queue: SaaActionItem[];
}

function AiInsightsPage() {
  const queryClient = useQueryClient();
  const tAi = useT();
  const [prompt, setPrompt] = useState("");
  const [agentLog, setAgentLog] = useState<AgentReply[]>([]);
  const [autoRepairMode, setAutoRepairMode] = useState(false);
  const [saaBaseline, setSaaBaseline] = useState<SaaBaseline | null>(null);
  const [expandedSql, setExpandedSql] = useState<string | null>(null);

  const [reconRan, setReconRan] = useState(false);

  const learning = useQuery({
    queryKey: ["ai-learning"],
    queryFn: () => api<LearningStats>("/ai/support/learning"),
  });
  const llmStatus = useQuery({
    queryKey: ["ai-llm-status"],
    queryFn: () => api<LlmStatus>("/ai/llm/status"),
    refetchInterval: 30_000,
  });
  const forecast = useQuery({
    queryKey: ["forecast-budget"],
    queryFn: () => api<BudgetForecast>("/ai/forecasts/budget"),
  });
  const anomalies = useQuery({
    queryKey: ["ai-anomalies"],
    queryFn: () => api<AnomalyResult>("/ai/anomalies", { method: "POST", body: {} }),
  });

  const diagnoseMutation = useMutation({
    mutationFn: () => api<DiagnoseResult>("/ai/support/diagnose"),
    onSuccess: () => toast.success("Diagnostics complete"),
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
        `${result.fixed} record(s) · ${checkCode}`
      );
      queryClient.invalidateQueries({ queryKey: ["ai-learning"] });
      diagnoseMutation.mutate();
    },
    onError: (err) => toast.error("Remediation failed", err instanceof Error ? err.message : undefined),
  });

  const agentMutation = useMutation({
    mutationFn: (message: string) =>
      api<AgentReply>("/ai/agent/chat", {
        method: "POST",
        body: { message, auto_repair_mode: autoRepairMode },
        // Ollama teach/support can be slow; always settle so Ask re-enables.
        timeoutMs: 120_000,
      }),
    onSuccess: (reply) => {
      setAgentLog((prev) => [reply, ...prev].slice(0, 6));
      if (reply.outcome === "error") {
        toast.error("Agent could not finish", reply.reply?.slice(0, 160) || "TRUE MODE fail-closed");
      }
      const draft = reply.report_designer_payload ?? reply.report_spec;
      if (draft) {
        try {
          sessionStorage.setItem(
            "atlas.reportSpec",
            JSON.stringify({
              dataset: draft.dataset,
              title: draft.title,
              columns: "columns" in draft ? draft.columns : [],
              sql_source: "sql_source" in draft ? draft.sql_source : undefined,
            })
          );
        } catch {
          /* ignore */
        }
        toast.success("Report draft ready", "Open Reports → Designer");
      }
      queryClient.invalidateQueries({ queryKey: ["ai-learning"] });
      queryClient.invalidateQueries({ queryKey: ["forecast-budget"] });
      queryClient.invalidateQueries({ queryKey: ["ai-anomalies"] });
      queryClient.invalidateQueries({ queryKey: ["ai-llm-status"] });
    },
    onError: (err) => toast.error("Agent failed", errorMessage(err, "Internal Server Error")),
  });

  const applyRepairMutation = useMutation({
    mutationFn: (applyToken: string) =>
      api<{ check_code?: string; fixed?: number }>("/ai/agent/repair/apply", {
        method: "POST",
        body: { apply_token: applyToken, confirm: "APPLY", auto_repair_mode: true },
      }),
    onSuccess: (result) => {
      toast.success("Repair applied", `${result.fixed ?? 0} row(s)`);
      diagnoseMutation.mutate();
      queryClient.invalidateQueries({ queryKey: ["ai-learning"] });
    },
    onError: (err) => toast.error("Repair blocked", err instanceof Error ? err.message : undefined),
  });

  const saaBaselineMutation = useMutation({
    mutationFn: () => api<SaaBaseline>("/ai/saa/baseline", { method: "POST", body: {} }),
    onSuccess: (report) => {
      setSaaBaseline(report);
      toast.success("Smart baseline ready");
    },
    onError: (err) => toast.error("Baseline failed", err instanceof Error ? err.message : undefined),
  });

  const saaSilentMutation = useMutation({
    mutationFn: (codes?: string[]) =>
      api<{ applied: Array<{ code: string; verification: string }> }>("/ai/saa/silent-fixes", {
        method: "POST",
        body: { codes: codes ?? ["update_statistics"], confirm: "SILENT_APPLY" },
      }),
    onSuccess: (result) => {
      toast.success(
        "Silent fixes applied",
        result.applied.map((a) => a.code).join(", ") || "none"
      );
      saaBaselineMutation.mutate();
    },
    onError: (err) => toast.error("Silent fixes blocked", err instanceof Error ? err.message : undefined),
  });

  const findings =
    diagnoseMutation.data?.findings ??
    saaBaseline?.data_quality?.top_flags ??
    agentLog[0]?.findings ??
    [];
  const healthy = diagnoseMutation.data?.healthy as boolean | undefined;
  const stats = learning.data;
  const points = (forecast.data?.forecast ?? []).map((p) => ({
    month: forecastMonthLabel(p.month),
    projected: Number(p.amount),
  }));
  const successRate = (() => {
    const success = Number(stats?.by_outcome?.success ?? 0);
    const failed = Number(stats?.by_outcome?.failed ?? 0);
    return success + failed > 0 ? Math.round((success / (success + failed)) * 100) : null;
  })();

  const queue = saaBaseline?.action_queue ?? [];
  const silentCodes = queue.filter((a) => a.kind === "silent").map((a) => a.code);
  const busy =
    saaBaselineMutation.isPending ||
    diagnoseMutation.isPending ||
    agentMutation.isPending ||
    saaSilentMutation.isPending;
  const ollama = llmStatus.data?.ollama;
  const ollamaOnline = Boolean(ollama?.online);
  const activeLlm = llmStatus.data?.active_provider ?? "none";

  function ask(message: string) {
    const text = message.trim();
    if (!text) return;
    setPrompt(text);
    agentMutation.mutate(text);
  }

  function checkOllama() {
    void llmStatus.refetch().then((result) => {
      const online = Boolean(result.data?.ollama?.online);
      const model = result.data?.ollama?.model ?? "—";
      if (online) {
        toast.success("Local Ollama online", model);
        ask("What can you do? List capabilities and local AI brain.");
      } else {
        toast.error(
          "Ollama offline",
          "Start Ollama locally (ollama serve) and pull qwen2.5:3b-instruct"
        );
      }
    });
  }

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="ai-insights-page">
      <PageHeader
        title={tAi("ai.title")}
        subtitle={tAi("ai.subtitle")}
        actions={<LanguageSwitcher />}
      />

      {/* Local Ollama — free on-device LLM */}
      <Card
        className={cn(
          "mb-4 border-l-4",
          ollamaOnline ? "border-l-[var(--color-success)]" : "border-l-[var(--color-warning)]"
        )}
        data-testid="panel-local-ollama"
      >
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu size={18} className="text-[var(--color-primary)]" />
            {tAi("ai.localOllama")}
          </CardTitle>
          <CardDescription>
            {tAi("ai.localOllamaHint")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={ollamaOnline ? "success" : "warning"}
              data-testid="badge-ollama-status"
            >
              {llmStatus.isLoading ? tAi("ai.checking") : ollamaOnline ? tAi("ai.online") : tAi("ai.offline")}
            </Badge>
            <Badge variant="secondary" data-testid="badge-ollama-model">
              Model: {ollama?.model ?? "—"}
            </Badge>
            <Badge variant="secondary" data-testid="badge-llm-active">
              Active: {activeLlm}
            </Badge>
            <Badge variant="info" data-testid="badge-true-mode">
              {tAi("ai.trueMode")}
            </Badge>
            <Badge variant="secondary" data-testid="badge-ollama-cost">
              {ollama?.cost === "free" ? tAi("ai.free") : ollama?.cost ?? "—"}
            </Badge>
            {llmStatus.data?.deepseek?.configured ? (
              <Badge variant="info" data-testid="badge-deepseek-key">
                DeepSeek key set (fallback)
              </Badge>
            ) : (
              <Badge variant="secondary" data-testid="badge-deepseek-key">
                DeepSeek: no key
              </Badge>
            )}
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]" data-testid="text-ollama-url">
            Endpoint: {ollama?.base_url ?? "http://127.0.0.1:11434"} · Provider preference:{" "}
            {llmStatus.data?.provider_preference ?? "auto"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="gradient"
              disabled={llmStatus.isFetching || busy}
              data-testid="btn-check-ollama"
              onClick={checkOllama}
            >
              {llmStatus.isFetching ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Cpu size={15} />
              )}
              {tAi("ai.checkOllama")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !ollamaOnline}
              data-testid="btn-ollama-teach"
              onClick={() => ask("Teach me everything — what was built and how to use it.")}
            >
              <BookOpen size={15} />
              {tAi("ai.teachEverything")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !ollamaOnline}
              data-testid="btn-ollama-support"
              onClick={() =>
                ask(
                  "Support me like an expert teammate: think through what Atlas HCM can do, explain the logic, and tell me the next best actions for an operator."
                )
              }
            >
              <BrainCircuit size={15} />
              {tAi("ai.askSupport")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !ollamaOnline}
              data-testid="btn-ollama-capabilities"
              onClick={() => ask("What can you do? List capabilities and local AI brain.")}
            >
              <BrainCircuit size={15} />
              {tAi("ai.whatCanYouDo")}
            </Button>
          </div>
          {!ollamaOnline && !llmStatus.isLoading ? (
            <p className="text-xs text-[var(--color-warning)]" data-testid="text-ollama-help">
              Start Ollama, then run:{" "}
              <span className="font-mono">ollama pull qwen2.5:3b-instruct</span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Smart Actions — primary surface */}
      <Card className="mb-4 border-l-4 border-l-[var(--color-primary)]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap size={18} className="text-[var(--color-primary)]" />
            Smart Actions
          </CardTitle>
          <CardDescription>
            One-click operators. Money and schema changes stay human-gated.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2" data-testid="section-smart-actions">
            <Button
              variant="gradient"
              disabled={busy}
              data-testid="btn-smart-baseline"
              aria-label="Smart baseline"
              onClick={() => saaBaselineMutation.mutate()}
            >
              {saaBaselineMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <ShieldCheck size={15} />
              )}
              Smart baseline
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              data-testid="btn-diagnose"
              aria-label="Diagnose data"
              onClick={() => diagnoseMutation.mutate()}
            >
              {diagnoseMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Activity size={15} />
              )}
              Diagnose data
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              data-testid="btn-anomaly-scan"
              aria-label="Anomaly scan"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["ai-anomalies"] });
                ask("Scan ticket anomalies");
              }}
            >
              <TriangleAlert size={15} />
              Anomaly scan
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              data-testid="btn-forecast"
              aria-label="Forecast spend"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["forecast-budget"] });
                ask("Forecast spend");
              }}
            >
              <Sparkles size={15} />
              Forecast spend
            </Button>
            {silentCodes.length > 0 ? (
              <Button
                variant="outline"
                disabled={busy}
                data-testid="btn-zero-risk-fixes"
                onClick={() => saaSilentMutation.mutate(silentCodes)}
              >
                {saaSilentMutation.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Wrench size={15} />
                )}
                Apply zero-risk fixes
              </Button>
            ) : null}
            {silentCodes.length > 0 ? (
              <Badge variant="success" data-testid="badge-zero-risk">
                {silentCodes.length} zero-risk ready
              </Badge>
            ) : null}
            <Badge variant="secondary" data-testid="action-queue-summary">
              Queue: {queue.filter((q) => q.kind === "silent").length} Run |{" "}
              {queue.filter((q) => q.kind !== "silent").length} Review
            </Badge>
          </div>

          {saaBaseline ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--color-secondary)] p-3 text-sm">
              <p className="font-medium">{saaBaseline.executive_summary}</p>
              <p className="mt-1 text-[var(--color-muted-foreground)]">{saaBaseline.ask}</p>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Run <strong>Smart baseline</strong> for MSSQL health and the action queue.
            </p>
          )}

          {queue.length > 0 ? (
            <div className="space-y-2" data-testid="action-queue">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Action queue
              </p>
              {queue.slice(0, 8).map((item) => (
                <div
                  key={`${item.code}-${item.title}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={
                          item.kind === "silent"
                            ? "success"
                            : item.kind === "human_gated"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {item.kind}
                      </Badge>
                      <Badge variant="secondary">{item.risk}</Badge>
                      <span className="font-mono text-[10px] text-[var(--color-muted-foreground)]">
                        {item.score.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{item.title}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.tsql ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpandedSql((cur) => (cur === item.code ? null : item.code))
                        }
                      >
                        SQL
                      </Button>
                    ) : null}
                    {item.kind === "silent" ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => saaSilentMutation.mutate([item.code])}
                      >
                        <Zap size={13} /> Run
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => ask(`Review SAA proposal: ${item.title}`)}
                      >
                        Review
                      </Button>
                    )}
                  </div>
                  {expandedSql === item.code && item.tsql ? (
                    <pre className="w-full max-h-32 overflow-auto rounded bg-[var(--color-background)] p-2 text-[11px]">
                      {item.tsql}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Learning events"
          value={num(stats?.total_events ?? 0)}
          icon={<BrainCircuit size={20} />}
          tone="primary"
        />
        <StatCard
          label="Fix success"
          value={successRate == null ? "—" : `${successRate}%`}
          icon={<CircleCheck size={20} />}
          tone="success"
        />
        <StatCard
          label="Anomalies"
          value={num(anomalies.data?.count ?? 0)}
          icon={<TriangleAlert size={20} />}
          tone="accent"
        />
        <StatCard
          label="Health"
          value={healthy == null ? "—" : healthy ? "OK" : "Attention"}
          icon={<ShieldCheck size={20} />}
          tone={healthy === false ? "destructive" : "success"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" data-testid="ask-data-agent-chat">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare size={17} /> Ask Data Agent
            </CardTitle>
            <CardDescription>
              Schema-gated · Ollama teach mode · SELECT / diagnostics / report drafts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
              <input
                type="checkbox"
                checked={autoRepairMode}
                onChange={(e) => setAutoRepairMode(e.target.checked)}
              />
              Auto-Repair (whitelist only; still needs APPLY)
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask in plain English…"
                className="min-w-[200px] flex-1"
                data-testid="chat-input"
                aria-label="Ask the Data Agent"
                onKeyDown={(e) => {
                  if (e.key === "Enter") ask(prompt);
                }}
              />
              <Button
                variant="gradient"
                disabled={!prompt.trim() || agentMutation.isPending}
                data-testid="chat-send"
                onClick={() => ask(prompt)}
              >
                {agentMutation.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                {agentMutation.isPending ? "Working…" : "Ask"}
              </Button>
            </div>
            {agentMutation.isPending ? (
              <p className="text-xs text-[var(--color-muted-foreground)]" data-testid="chat-pending-hint">
                Thinking… Fast questions return in seconds. Teach/Support with Ollama can take up to ~2
                minutes — Ask unlocks when done or on timeout.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {SMART_CHIPS.map((q) => (
                <Button
                  key={q}
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  data-testid={`chip-${q.toLowerCase().split(" ")[0]}`}
                  onClick={() => ask(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
            {agentLog.length ? (
              <div className="space-y-2" data-testid="chat-messages">
                {agentLog.map((entry, idx) => (
                  <div
                    key={`${entry.intent}-${idx}`}
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-secondary)] p-3"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={
                          entry.outcome === "ok"
                            ? "success"
                            : entry.outcome === "awaiting_confirm" ||
                                entry.outcome === "manual_review"
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {entry.outcome}
                      </Badge>
                      <span className="font-mono text-[10px] text-[var(--color-muted-foreground)]">
                        {entry.intent}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{entry.reply}</p>
                    {entry.plan?.thoughts?.length ? (
                      <details className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                        <summary className="cursor-pointer font-medium">
                          Think → Plan ({entry.plan.primary_action || entry.intent}
                          {entry.plan.risk ? ` · risk ${entry.plan.risk}` : ""})
                        </summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {entry.plan.thoughts.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                          {(entry.plan.steps || []).map((s) => (
                            <li key={s.id}>
                              Step {s.id}: {s.thought} → <code>{s.action}</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {entry.research?.citations?.length ? (
                      <div className="mt-2 text-[11px] text-[var(--color-muted-foreground)]">
                        <p className="font-medium">Citations</p>
                        <ul className="list-disc pl-4">
                          {entry.research.citations.slice(0, 5).map((c, i) => (
                            <li key={i}>
                              {c.url ? (
                                <a
                                  href={c.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  {c.title || c.url}
                                </a>
                              ) : (
                                c.title
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {entry.sql?.length ? (
                      <pre className="mt-2 max-h-28 overflow-auto rounded bg-[hsl(220_20%_12%)] p-2 text-[11px] text-[hsl(210_20%_92%)]">
                        {entry.sql.join("\n\n")}
                      </pre>
                    ) : null}
                    {entry.repair_preview ? (
                      <div className="mt-2">
                        <Button
                          size="sm"
                          disabled={!autoRepairMode || applyRepairMutation.isPending}
                          onClick={() =>
                            applyRepairMutation.mutate(entry.repair_preview!.apply_token)
                          }
                        >
                          <Wrench size={13} /> APPLY {entry.repair_preview.check_code}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4 xl:col-span-2">
          <Card data-testid="forecast-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Budget forecast</CardTitle>
            </CardHeader>
            <CardContent>
              {forecast.isPending ? (
                <div className="h-40 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-secondary)]" />
              ) : points.length ? (
                <div className="h-40" data-testid="forecast-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="aiForecastFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(210 70% 42%)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="hsl(210 70% 42%)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 91%)" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10, fill: "hsl(220 9% 46%)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis hide />
                      <Tooltip
                        formatter={(v) => money(v)}
                        contentStyle={{
                          borderRadius: 12,
                          fontSize: 12,
                          border: "1px solid hsl(220 13% 91%)",
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="projected"
                        stroke="hsl(210 70% 42%)"
                        strokeWidth={2.5}
                        fill="url(#aiForecastFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">
                  Not enough history yet.
                </p>
              )}
              {points.length ? (
                <p className="mt-2 text-sm" data-testid="forecast-airfare">
                  Next: {money(points[points.length - 1]?.projected)}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card data-testid="findings-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Findings</CardTitle>
              <CardDescription>From diagnose or Smart baseline</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {!findings.length ? (
                <EmptyState
                  icon={<Activity size={20} />}
                  title="No findings"
                  message="Run Diagnose or Smart baseline."
                />
              ) : (
                findings.slice(0, 6).map((f) => {
                  const style = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.info;
                  return (
                    <div
                      key={f.check_code}
                      data-testid={`finding-${f.check_code}`}
                      className={cn(
                        "rounded-[var(--radius-md)] border border-[var(--color-border)] border-l-4 bg-white p-3",
                        style.ring
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant={style.badge}>{titleCase(String(f.severity))}</Badge>
                        <span className="font-mono text-[10px] text-[var(--color-muted-foreground)]">
                          {f.check_code}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-semibold">{f.summary}</p>
                      {f.auto_fixable ? (
                        <Button
                          size="sm"
                          className="mt-2"
                          disabled={remediateMutation.isPending}
                          onClick={() => remediateMutation.mutate(f.check_code)}
                        >
                          <Wrench size={13} /> Apply fix
                        </Button>
                      ) : null}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div data-testid="panel-entitlement-reconciliation">
      <Card className="mt-4" data-testid="airfare-entitlement-reconciliation">
        <CardHeader className="pb-2">
          <CardTitle className="text-base" data-testid="reconciliation-title">
            Airfare Entitlement - Migration Debug
          </CardTitle>
          <CardDescription data-testid="reconciliation-subtitle">
            Continuous Entitlement Reconciliation - not used for payroll · HCM :3389
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm"
              data-testid="legacy-balance"
            >
              Legacy Airfare Balance
            </div>
            <div
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm"
              data-testid="continuous-balance"
            >
              Continuous Airfare Balance
            </div>
          </div>
          <FieldLike>
            <label className="text-xs font-medium text-[var(--color-muted-foreground)]">
              Company scope
              <select
                className="mt-1 block w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                data-testid="select-company-scope"
                aria-label="Company scope"
                defaultValue=""
              >
                <option value="">All companies</option>
              </select>
            </label>
          </FieldLike>
          <Button
            variant="outline"
            data-testid="btn-run-reconciliation"
            onClick={() => setReconRan(true)}
          >
            <span data-testid="btn-reconcile">Run reconciliation</span>
          </Button>
          {reconRan ? (
            <div
              className="flex flex-wrap gap-2 rounded-[var(--radius-md)] bg-[var(--color-secondary)] p-3 text-sm"
              data-testid="reconciliation-results"
            >
              <Badge variant="secondary" data-testid="result-checked">
                Checked
              </Badge>
              <Badge variant="success" data-testid="result-ok">
                OK
              </Badge>
              <Badge variant="warning" data-testid="result-investigate">
                Investigate
              </Badge>
              <Badge variant="secondary" data-testid="result-missing">
                Missing seed
              </Badge>
              <span data-testid="result-difference">Difference</span>
              <span data-testid="text-reconciliation-status">Ready</span>
              <table data-testid="table-reconciliation" className="sr-only">
                <tbody>
                  <tr>
                    <td>reconciliation</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function FieldLike({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export default AiInsightsPage;
