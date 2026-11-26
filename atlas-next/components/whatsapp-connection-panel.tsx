"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, QrCode, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { hasRole, useAuth, isAdmin } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatWhatsAppDisplayList, parseWhatsAppNumbers } from "@/lib/whatsapp-click-to-chat";

type WaInstance = {
  name: string;
  state?: string;
  phone?: string | null;
  mode?: string;
};

type WaStatus = {
  enabled: boolean;
  configured: boolean;
  reachable?: boolean;
  reach_error?: string | null;
  base_url?: string | null;
  port?: number | null;
  local_host?: boolean;
  can_ensure_local?: boolean;
  ensure_script_present?: boolean;
  evolution_src_present?: boolean;
  docker_required?: boolean;
  deps?: {
    missing?: string[];
    repair_hint?: string | null;
    node_modules_present?: boolean;
    baileys_present?: boolean;
    npm_on_path?: boolean;
    postgresql_up?: boolean;
  } | null;
  remote_hint?: string | null;
  last_ensure?: {
    state?: string;
    exit_code?: number;
    detail?: string;
    start_mode?: string;
    ts?: string;
  } | null;
  default_instance?: string;
  webhook_public_url?: string | null;
};

type WaPortCheck = {
  diagnosis?: string;
  mismatch?: boolean;
  wrong_infra_port?: boolean;
  recommended_port?: number | null;
  recommended_base_url?: string | null;
  suggest_free_port?: number | null;
  official_default_port?: number;
  docs?: string;
  current?: {
    base_url?: string;
    port?: number | null;
    reachable?: boolean;
    tcp_open?: boolean;
    role?: string;
    infra?: boolean;
  };
  candidates?: Array<{
    port: number;
    base_url: string;
    tcp_open: boolean;
    reachable: boolean;
    recommended?: boolean;
    role?: string;
    infra?: boolean;
  }>;
  used_ports?: Array<{
    source: string;
    port: number;
    role?: string;
    infra?: boolean;
    base_url?: string;
  }>;
  listen_inventory?: Array<{
    port: number;
    tcp_open: boolean;
    role?: string;
    infra?: boolean;
    evolution_candidate?: boolean;
  }>;
};

function stateTone(state?: string): "success" | "warning" | "destructive" | "secondary" {
  const s = (state || "").toLowerCase();
  if (s === "open" || s === "connected") return "success";
  if (s === "qrcode" || s === "connecting") return "warning";
  if (s === "close" || s === "closed") return "destructive";
  return "secondary";
}

function stateLabel(state?: string): string {
  const s = (state || "unknown").toLowerCase();
  if (s === "open") return "Connected";
  if (s === "qrcode") return "Scan Required";
  if (s === "connecting") return "Connecting";
  if (s === "close" || s === "closed") return "Disconnected";
  return state || "Unknown";
}

function prefListToText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map(String).join("\n");
  return "";
}

export function WhatsAppConnectionPanel() {
  const { me } = useAuth();
  const adminOps = isAdmin(me);
  const canSaveDefaults = hasRole(me, "admin", "system_admin", "hr", "hr_manager");
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const [createName, setCreateName] = useState("lab-ops-bh-01");
  const [mode, setMode] = useState<"baileys" | "cloud">("baileys");
  const [cloudToken, setCloudToken] = useState("");
  const [cloudNumber, setCloudNumber] = useState("");
  const [cloudBiz, setCloudBiz] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testText, setTestText] = useState(
    "ATLAS WhatsApp test. Your request has been received. External ID will be a UUID."
  );
  const [distManagers, setDistManagers] = useState("");
  const [distHr, setDistHr] = useState("");
  const [distMd, setDistMd] = useState("");
  const [distHydrated, setDistHydrated] = useState(false);
  const [qrCountdown, setQrCountdown] = useState(20);
  const [portDraft, setPortDraft] = useState("");
  const [portReport, setPortReport] = useState<WaPortCheck | null>(null);

  const statusQ = useQuery({
    queryKey: ["wa-status"],
    queryFn: () => api<WaStatus>("/admin/wa/status"),
    refetchInterval: 15_000,
  });

  const prefsQ = useQuery({
    queryKey: ["preferences", "effective", "whatsapp"],
    queryFn: () => api<Record<string, unknown>>("/preferences/effective"),
  });

  useEffect(() => {
    if (!prefsQ.data || distHydrated) return;
    const managers =
      prefListToText(prefsQ.data.whatsapp_manager_recipients) ||
      prefListToText(prefsQ.data.whatsapp_default_recipients);
    setDistManagers(managers);
    setDistHr(prefListToText(prefsQ.data.whatsapp_hr_recipients));
    setDistMd(prefListToText(prefsQ.data.whatsapp_md_recipients));
    setDistHydrated(true);
  }, [prefsQ.data, distHydrated]);

  const instancesQ = useQuery({
    queryKey: ["wa-instances"],
    queryFn: () => api<{ instances: WaInstance[]; evolution_error?: string }>("/admin/wa/instances"),
    enabled: Boolean(statusQ.data?.enabled && statusQ.data?.configured),
    refetchInterval: 5_000,
  });

  const instances = instancesQ.data?.instances ?? [];
  const activeName = selected || instances[0]?.name || statusQ.data?.default_instance || "";
  const active = useMemo(
    () => instances.find((i) => i.name === activeName),
    [instances, activeName]
  );

  const needQr =
    adminOps &&
    Boolean(activeName) &&
    (active?.mode === "baileys" || mode === "baileys") &&
    ["qrcode", "connecting", "close", "closed", "unknown", undefined].includes(
      (active?.state || "unknown").toLowerCase()
    ) &&
    (active?.state || "").toLowerCase() !== "open";

  const qrQ = useQuery({
    queryKey: ["wa-qr", activeName],
    queryFn: () => api<{ qrcode_base64?: string | null }>(`/admin/wa/instances/${encodeURIComponent(activeName)}/qr`),
    enabled: Boolean(adminOps && statusQ.data?.enabled && statusQ.data?.configured && activeName && needQr),
    refetchInterval: needQr ? 20_000 : false,
  });

  const eventsQ = useQuery({
    queryKey: ["wa-events"],
    queryFn: () => api<{ events: Array<{ ts: number; event_type: string; instance: string; summary: string }> }>("/admin/wa/events"),
    enabled: Boolean(statusQ.data?.enabled),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!needQr) return;
    setQrCountdown(20);
    const id = window.setInterval(() => {
      setQrCountdown((c) => (c <= 1 ? 20 : c - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [needQr, qrQ.dataUpdatedAt]);

  const createMut = useMutation({
    mutationFn: () =>
      api("/admin/wa/instances", {
        method: "POST",
        body: {
          instance_name: createName.trim(),
          mode,
          token: mode === "cloud" ? cloudToken : undefined,
          number: mode === "cloud" ? cloudNumber : undefined,
          business_id: mode === "cloud" ? cloudBiz : undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Instance create requested");
      setSelected(createName.trim());
      qc.invalidateQueries({ queryKey: ["wa-instances"] });
      qc.invalidateQueries({ queryKey: ["wa-qr"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const connectMut = useMutation({
    mutationFn: () =>
      api(`/admin/wa/instances/${encodeURIComponent(activeName)}/connect`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Reconnect requested");
      qc.invalidateQueries({ queryKey: ["wa-qr"] });
      qc.invalidateQueries({ queryKey: ["wa-instances"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const testMut = useMutation({
    mutationFn: () =>
      api("/admin/wa/send/test", {
        method: "POST",
        body: {
          instance_name: activeName,
          number: testPhone,
          text: testText,
          template_hint: "usr_request_received_en",
        },
      }),
    onSuccess: () => {
      toast.success("Test message sent");
      qc.invalidateQueries({ queryKey: ["wa-events"] });
    },
    onError: (e) => toast.error("WhatsApp test failed", errorMessage(e)),
  });

  const canSendTest =
    Boolean(activeName) &&
    Boolean(testPhone.trim()) &&
    (active?.state || "").toLowerCase() === "open";

  const saveDistMut = useMutation({
    mutationFn: async () => {
      const put = (key: string, raw: string) =>
        api("/preferences", {
          method: "PUT",
          body: {
            scope_type: "global",
            scope_id: "",
            preference_key: key,
            value: parseWhatsAppNumbers(raw).join("\n"),
            is_locked: false,
          },
        });
      await put("whatsapp_manager_recipients", distManagers);
      await put("whatsapp_hr_recipients", distHr);
      await put("whatsapp_md_recipients", distMd);
      // Legacy manager alias — document / offer desks still read whatsapp_default_recipients.
      await put("whatsapp_default_recipients", distManagers);
    },
    onSuccess: () => {
      toast.success(
        "WhatsApp distribution saved",
        "Reporting managers, HR, and MD lists are the source of truth for allocation notify."
      );
      qc.invalidateQueries({ queryKey: ["preferences"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const ensureMut = useMutation({
    mutationFn: (forceRestart: boolean) =>
      api<{ ok: boolean; message?: string; reachable?: boolean }>("/admin/wa/ensure-local", {
        method: "POST",
        body: { force_restart: forceRestart },
      }),
    onSuccess: (data) => {
      if (data.ok || data.reachable) {
        toast.success("Evolution is reachable", data.message || "WhatsApp helper is up.");
      } else {
        toast.error("Evolution still offline", data.message || "Check the ATLAS server logs.");
      }
      qc.invalidateQueries({ queryKey: ["wa-status"] });
      qc.invalidateQueries({ queryKey: ["wa-instances"] });
    },
    onError: (e) => toast.error("Could not start Evolution", errorMessage(e)),
  });

  const portCheckMut = useMutation({
    mutationFn: () => api<WaPortCheck>("/admin/wa/port-check"),
    onSuccess: (data) => {
      setPortReport(data);
      if (data.recommended_port) setPortDraft(String(data.recommended_port));
      else if (data.current?.port) setPortDraft(String(data.current.port));
      if (data.mismatch) {
        toast.warning("Wrong port detected", data.diagnosis || "Apply the recommended port.");
      } else {
        toast.success("Port check complete", data.diagnosis || "See results below.");
      }
    },
    onError: (e) => toast.error("Port check failed", errorMessage(e)),
  });

  const portApplyMut = useMutation({
    mutationFn: (port: number) =>
      api<{ ok: boolean; next?: string; applied?: { base_url?: string } }>("/admin/wa/port", {
        method: "POST",
        body: { port, sync_evolution: true, restart_local: true },
      }),
    onSuccess: async (data) => {
      toast.success(
        "Evolution URL updated",
        data.applied?.base_url || data.next || "Port saved — starting Evolution…"
      );
      qc.invalidateQueries({ queryKey: ["wa-status"] });
      try {
        await ensureMut.mutateAsync(true);
      } catch {
        /* ensure toast already shown */
      }
      portCheckMut.mutate();
    },
    onError: (e) => toast.error("Could not apply port", errorMessage(e)),
  });

  useEffect(() => {
    if (statusQ.data?.port && !portDraft) setPortDraft(String(statusQ.data.port));
  }, [statusQ.data?.port, portDraft]);

  const enabled = statusQ.data?.enabled;
  const configured = statusQ.data?.configured;
  const reachable = statusQ.data?.reachable;
  const qrSrc = qrQ.data?.qrcode_base64
    ? qrQ.data.qrcode_base64.startsWith("data:")
      ? qrQ.data.qrcode_base64
      : `data:image/png;base64,${qrQ.data.qrcode_base64}`
    : null;

  const badgeLabel = statusQ.isLoading
    ? "Checking…"
    : !enabled
      ? "Disabled"
      : !configured
        ? "Not configured"
        : reachable
          ? "Configured"
          : "Evolution offline";
  const badgeVariant = statusQ.isLoading
    ? "secondary"
    : !enabled
      ? "warning"
      : !configured
        ? "warning"
        : reachable
          ? "success"
          : "destructive";

  return (
    <Card data-testid="whatsapp-connection-panel">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4" />
              WhatsApp (Evolution)
            </CardTitle>
            <CardDescription>
              Cloud-first approvals · Baileys QR for lab · Decision lock enforced on send
            </CardDescription>
          </div>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQ.isLoading ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Checking Evolution connectivity…</p>
        ) : !enabled || !configured ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Set <code className="text-xs">AIRFARE_EVOLUTION_ENABLED=true</code>,{" "}
            <code className="text-xs">AIRFARE_EVOLUTION_BASE_URL</code>,{" "}
            <code className="text-xs">AIRFARE_EVOLUTION_API_KEY</code>, and{" "}
            <code className="text-xs">AIRFARE_EVOLUTION_WEBHOOK_PUBLIC_URL</code> on the API, then
            restart.
          </p>
        ) : reachable === false ? (
          <div className="space-y-3 text-sm text-[var(--color-muted-foreground)]">
            <p>
              ATLAS is configured, but Evolution API is not reachable at{" "}
              <code className="text-xs">{statusQ.data?.base_url}</code>.
            </p>
            <p>
              Common after a server restart when Evolution did not come back with the API. Start it
              on this server, or point ATLAS at Evolution on another machine via{" "}
              <code className="text-xs">AIRFARE_EVOLUTION_BASE_URL</code>.
            </p>
            {statusQ.data?.reach_error ? (
              <p className="text-xs text-[var(--color-muted-foreground)]" dir="ltr">
                {statusQ.data.reach_error}
              </p>
            ) : null}
            {statusQ.data?.remote_hint ? (
              <p className="text-xs" dir="ltr">
                {statusQ.data.remote_hint}
              </p>
            ) : null}
            {adminOps ? (
              <div
                className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--brand-50)]/40 p-3"
                data-testid="wa-port-fix"
              >
                <p className="text-sm font-semibold text-[var(--color-foreground)]">
                  Evolution port desk (never use 5432 — that is PostgreSQL)
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]" dir="ltr">
                  ATLAS URL: {statusQ.data?.base_url || "—"} · configured port{" "}
                  {statusQ.data?.port ?? "—"}
                  {portReport?.current?.role ? ` · ${portReport.current.role}` : ""}. Official
                  Evolution default is{" "}
                  <strong>{portReport?.official_default_port ?? 8080}</strong>. Check ports shows
                  what was configured vs what is listening, then Apply.
                </p>
                {portReport?.wrong_infra_port ? (
                  <p
                    className="rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.08)] px-2 py-1.5 text-xs text-[var(--color-destructive)]"
                    dir="ltr"
                    data-testid="wa-port-infra-warning"
                  >
                    Wrong service: this URL hits an infrastructure port (e.g. Postgres 5432), not
                    Evolution HTTP. Apply {portReport.recommended_port ?? 8080}.
                  </p>
                ) : null}
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Port">
                    <Input
                      className="w-28"
                      inputMode="numeric"
                      value={portDraft}
                      data-testid="wa-port-input"
                      onChange={(e) => setPortDraft(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    />
                  </Field>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={portCheckMut.isPending}
                    onClick={() => portCheckMut.mutate()}
                    data-testid="wa-port-check"
                  >
                    {portCheckMut.isPending ? "Checking…" : "Check ports"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      portApplyMut.isPending ||
                      !portDraft ||
                      Number(portDraft) < 1024 ||
                      Number(portDraft) === 5432
                    }
                    onClick={() => portApplyMut.mutate(Number(portDraft))}
                    data-testid="wa-port-apply"
                  >
                    {portApplyMut.isPending ? "Applying…" : "Apply port"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={portApplyMut.isPending}
                    onClick={() => {
                      const p = Number(portReport?.recommended_port ?? portReport?.official_default_port ?? 8080);
                      setPortDraft(String(p));
                      portApplyMut.mutate(p);
                    }}
                    data-testid="wa-port-use-recommended"
                  >
                    Use recommended ({portReport?.recommended_port ?? portReport?.official_default_port ?? 8080})
                  </Button>
                </div>
                {portReport?.diagnosis ? (
                  <p className="text-xs" dir="ltr" data-testid="wa-port-diagnosis">
                    {portReport.diagnosis}
                  </p>
                ) : null}
                {portReport?.used_ports?.length ? (
                  <div className="text-xs" dir="ltr" data-testid="wa-port-history">
                    <p className="font-medium text-[var(--color-foreground)]">Ports used / configured</p>
                    <ul className="mt-1 space-y-0.5 text-[var(--color-muted-foreground)]">
                      {portReport.used_ports.slice(0, 8).map((u) => (
                        <li key={`${u.source}-${u.port}`}>
                          {u.port}
                          {u.infra ? " ⚠" : ""} — {u.role || "—"}{" "}
                          <span className="opacity-70">({u.source.split(/[/\\]/).slice(-2).join("/")})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {portReport?.listen_inventory?.filter((r) => r.tcp_open).length ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]" dir="ltr" data-testid="wa-port-listen">
                    Listening now:{" "}
                    {portReport.listen_inventory
                      .filter((r) => r.tcp_open)
                      .map((r) => `${r.port}${r.infra ? "⚠" : r.evolution_candidate ? "~" : ""}`)
                      .join(", ")}
                  </p>
                ) : null}
                {portReport?.candidates?.length ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]" dir="ltr">
                    Evolution scan:{" "}
                    {portReport.candidates
                      .filter((c) => c.tcp_open || c.reachable || c.recommended)
                      .map(
                        (c) =>
                          `${c.port}${c.reachable ? "✓" : c.tcp_open ? "~" : ""}${
                            c.recommended ? "*" : ""
                          }`
                      )
                      .join(", ") || "none open — start Evolution on 8080"}
                  </p>
                ) : null}
              </div>
            ) : null}
            {adminOps && statusQ.data?.local_host ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={ensureMut.isPending || !statusQ.data?.can_ensure_local}
                  onClick={() => ensureMut.mutate(false)}
                >
                  {ensureMut.isPending ? "Starting…" : "Start Evolution on this server"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={ensureMut.isPending || !statusQ.data?.can_ensure_local}
                  onClick={() => ensureMut.mutate(true)}
                >
                  Force restart
                </Button>
              </div>
            ) : null}
            {adminOps && statusQ.data?.deps?.missing?.length ? (
              <p className="text-xs" dir="ltr">
                Missing on this server: {statusQ.data.deps.missing.join(", ")}. Docker is{" "}
                <strong>not</strong> required — use native Node.js + PostgreSQL.{" "}
                {statusQ.data.deps.repair_hint ||
                  "Run Repair-Evolution-Dependencies.ps1 then start-evolution.ps1."}
              </p>
            ) : null}
            {adminOps && statusQ.data?.local_host && !statusQ.data?.can_ensure_local ? (
              <p className="text-xs">
                Cannot start Evolution from the UI (no script and no{" "}
                <code className="text-xs">evolution-api</code> tree). Copy companion scripts from
                the 3.0.8 release, or reinstall with the WhatsApp component. Docker is not required.
              </p>
            ) : null}
            {adminOps && statusQ.data?.local_host === false ? (
              <p className="text-xs">
                Remote Evolution: start the helper on that host (and set its{" "}
                <code className="text-xs">SERVER_URL</code>), keep the API key aligned, then refresh
                this panel. Recipient numbers can still be changed below.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            {instancesQ.isError ? (
              <p className="text-sm text-red-600" dir="ltr">
                Instance list failed: {errorMessage(instancesQ.error)}. Evolution may still be up —
                retry refresh.
              </p>
            ) : null}            <div className="flex flex-wrap items-center gap-2">
              {active?.state?.toLowerCase() === "open" ? (
                <Wifi className="h-4 w-4 text-emerald-600" />
              ) : (
                <WifiOff className="h-4 w-4 text-amber-600" />
              )}
              <Badge variant={stateTone(active?.state)}>{stateLabel(active?.state)}</Badge>
              {active?.phone ? (
                <span className="text-sm font-medium" dir="ltr">
                  +{String(active.phone).replace(/\D/g, "")}
                </span>
              ) : null}
              {instancesQ.data?.evolution_error ? (
                <span className="text-xs text-red-600">{instancesQ.data.evolution_error}</span>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-[var(--color-muted-foreground)]">Active instance</span>
                <Select
                  value={activeName}
                  onChange={(e) => setSelected(e.target.value)}
                  disabled={!instances.length}
                >
                  {instances.length === 0 ? <option value="">No instances</option> : null}
                  {instances.map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name} ({i.mode || "?"}) — {stateLabel(i.state)}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="flex items-end gap-2">
                {adminOps ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!activeName || connectMut.isPending}
                    onClick={() => connectMut.mutate()}
                  >
                    <RefreshCw className={cn("h-4 w-4", connectMut.isPending && "animate-spin")} />
                    Reconnect / refresh QR
                  </Button>
                ) : (
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Connection / QR / send actions require an admin account.
                  </p>
                )}
              </div>
            </div>

            {needQr ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <QrCode className="h-4 w-4" />
                  Scan with WhatsApp → Settings → Linked Devices
                  <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">
                    QR refresh in {qrCountdown}s
                  </span>
                </div>
                {qrSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrSrc}
                    alt="WhatsApp QR code"
                    className="mx-auto h-56 w-56 rounded bg-white p-2"
                    data-testid="whatsapp-qr-image"
                  />
                ) : (
                  <p className="text-sm text-[var(--color-muted-foreground)]">Waiting for QR from Evolution…</p>
                )}
              </div>
            ) : null}

            {adminOps ? (
            <div className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 md:grid-cols-2">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-[var(--color-muted-foreground)]">New instance name</span>
                <Input value={createName} onChange={(e) => setCreateName(e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--color-muted-foreground)]">Mode</span>
                <Select value={mode} onChange={(e) => setMode(e.target.value as "baileys" | "cloud")}>
                  <option value="baileys">Baileys (QR / lab)</option>
                  <option value="cloud">Cloud (Meta / production buttons)</option>
                </Select>
              </label>
              {mode === "cloud" ? (
                <>
                  <label className="space-y-1 text-sm">
                    <span className="text-[var(--color-muted-foreground)]">Meta access token</span>
                    <Input value={cloudToken} onChange={(e) => setCloudToken(e.target.value)} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-[var(--color-muted-foreground)]">Phone number ID</span>
                    <Input value={cloudNumber} onChange={(e) => setCloudNumber(e.target.value)} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-[var(--color-muted-foreground)]">WABA / business ID</span>
                    <Input value={cloudBiz} onChange={(e) => setCloudBiz(e.target.value)} />
                  </label>
                </>
              ) : null}
              <div className="flex items-end">
                <Button
                  type="button"
                  disabled={createMut.isPending || !createName.trim()}
                  onClick={() => createMut.mutate()}
                >
                  Create instance
                </Button>
              </div>
            </div>
            ) : null}

            {adminOps ? (
            <div className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3">
              <p className="text-sm font-medium">Test send (admin phone)</p>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--color-muted-foreground)]">E.164 digits (change freely)</span>
                <Input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="973501234567"
                  dir="ltr"
                  data-testid="input-whatsapp-test-phone"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--color-muted-foreground)]">Message (no emoji)</span>
                <Input value={testText} onChange={(e) => setTestText(e.target.value)} />
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={!canSendTest || testMut.isPending}
                onClick={() => {
                  if ((active?.state || "").toLowerCase() !== "open") {
                    toast.error(
                      "WhatsApp not connected",
                      "Scan the QR above (only one instance per phone), wait until Connected, then Send test."
                    );
                    return;
                  }
                  testMut.mutate();
                }}
              >
                Send test
              </Button>
              {(active?.state || "").toLowerCase() !== "open" ? (
                <p className="text-xs text-[var(--color-destructive)]">
                  Instance is {stateLabel(active?.state)}. Connect + scan QR before sending. If several
                  instances share one phone, logout the extras — they kick each other offline.
                </p>
              ) : null}
            </div>
            ) : null}

            <div>
              <p className="mb-2 text-sm font-medium">Recent webhook / send events</p>
              <div className="max-h-48 overflow-auto rounded border border-[var(--color-border)] text-xs">
                {(eventsQ.data?.events ?? []).length === 0 ? (
                  <p className="p-3 text-[var(--color-muted-foreground)]">No events yet.</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-border)]">
                    {(eventsQ.data?.events ?? []).slice(0, 20).map((ev, idx) => (
                      <li key={`${ev.ts}-${idx}`} className="flex gap-2 px-3 py-2">
                        <span className="shrink-0 text-[var(--color-muted-foreground)]">
                          {new Date(ev.ts * 1000).toLocaleTimeString("en-GB")}
                        </span>
                        <span className="font-medium">{ev.event_type}</span>
                        <span className="truncate text-[var(--color-muted-foreground)]">
                          {ev.instance}: {ev.summary}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}

        {!statusQ.isLoading ? (
          <div
            id="whatsapp-distribution-settings"
            className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3"
            data-testid="whatsapp-distribution-settings"
          >
            <p className="text-sm font-medium">Distribution lists (Settings source of truth)</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Reporting managers, HR, and MD numbers used by Allocation WhatsApp notify. Manager list also
              mirrors legacy <code className="text-xs">whatsapp_default_recipients</code> for offer/contract
              prefill. One number per line (max 5 per list).
            </p>
            <Field label="Reporting / approval managers">
              <Textarea
                value={distManagers}
                readOnly={!canSaveDefaults}
                data-testid="input-whatsapp-manager-recipients"
                placeholder={"97335000001\n97335000002"}
                dir="ltr"
                rows={3}
                className="font-mono text-sm"
                onChange={(e) => setDistManagers(e.target.value)}
              />
              {parseWhatsAppNumbers(distManagers).length > 0 ? (
                <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]" dir="ltr">
                  Managers: {formatWhatsAppDisplayList(distManagers)}
                </p>
              ) : null}
            </Field>
            <Field label="HR distribution">
              <Textarea
                value={distHr}
                readOnly={!canSaveDefaults}
                data-testid="input-whatsapp-hr-recipients"
                placeholder="97335000003"
                dir="ltr"
                rows={2}
                className="font-mono text-sm"
                onChange={(e) => setDistHr(e.target.value)}
              />
            </Field>
            <Field label="Managing Director (MD)">
              <Textarea
                value={distMd}
                readOnly={!canSaveDefaults}
                data-testid="input-whatsapp-md-recipients"
                placeholder="97335000004"
                dir="ltr"
                rows={2}
                className="font-mono text-sm"
                onChange={(e) => setDistMd(e.target.value)}
              />
            </Field>
            {canSaveDefaults ? (
              <Button
                type="button"
                variant="outline"
                data-testid="btn-save-whatsapp-defaults"
                disabled={saveDistMut.isPending}
                onClick={() => saveDistMut.mutate()}
              >
                Save distribution lists
              </Button>
            ) : (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Only HR or an administrator can change distribution lists.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
