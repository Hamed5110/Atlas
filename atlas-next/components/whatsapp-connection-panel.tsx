"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, QrCode, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

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
  default_instance?: string;
  webhook_public_url?: string | null;
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

export function WhatsAppConnectionPanel() {
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
  const [qrCountdown, setQrCountdown] = useState(20);

  const statusQ = useQuery({
    queryKey: ["wa-status"],
    queryFn: () => api<WaStatus>("/admin/wa/status"),
    refetchInterval: 15_000,
  });

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
    Boolean(activeName) &&
    (active?.mode === "baileys" || mode === "baileys") &&
    ["qrcode", "connecting", "close", "closed", "unknown", undefined].includes(
      (active?.state || "unknown").toLowerCase()
    ) &&
    (active?.state || "").toLowerCase() !== "open";

  const qrQ = useQuery({
    queryKey: ["wa-qr", activeName],
    queryFn: () => api<{ qrcode_base64?: string | null }>(`/admin/wa/instances/${encodeURIComponent(activeName)}/qr`),
    enabled: Boolean(statusQ.data?.enabled && statusQ.data?.configured && activeName && needQr),
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
    onError: (e) => toast.error(errorMessage(e)),
  });

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
          <p className="text-sm text-[hsl(215_16%_40%)]">Checking Evolution connectivity…</p>
        ) : !enabled || !configured ? (
          <p className="text-sm text-[hsl(215_16%_40%)]">
            Set <code className="text-xs">AIRFARE_EVOLUTION_ENABLED=true</code>,{" "}
            <code className="text-xs">AIRFARE_EVOLUTION_BASE_URL</code>,{" "}
            <code className="text-xs">AIRFARE_EVOLUTION_API_KEY</code>, and{" "}
            <code className="text-xs">AIRFARE_EVOLUTION_WEBHOOK_PUBLIC_URL</code> on the API, then
            restart.
          </p>
        ) : reachable === false ? (
          <div className="space-y-2 text-sm text-[hsl(215_16%_40%)]">
            <p>
              ATLAS is configured, but Evolution API is not reachable at{" "}
              <code className="text-xs">{statusQ.data?.base_url}</code>.
            </p>
            <p>
              Start Evolution API v2 on that host (Docker or binary), then click refresh / reopen
              Settings. QR scan and sends stay blocked until Evolution responds.
            </p>
            {statusQ.data?.reach_error ? (
              <p className="text-xs text-red-600" dir="ltr">
                {statusQ.data.reach_error}
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
                <span className="text-[hsl(215_16%_40%)]">Active instance</span>
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
                <Button
                  type="button"
                  variant="outline"
                  disabled={!activeName || connectMut.isPending}
                  onClick={() => connectMut.mutate()}
                >
                  <RefreshCw className={cn("h-4 w-4", connectMut.isPending && "animate-spin")} />
                  Reconnect / refresh QR
                </Button>
              </div>
            </div>

            {needQr ? (
              <div className="rounded-lg border border-[hsl(214_32%_88%)] bg-[hsl(210_40%_98%)] p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <QrCode className="h-4 w-4" />
                  Scan with WhatsApp → Settings → Linked Devices
                  <span className="ml-auto text-xs text-[hsl(215_16%_47%)]">
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
                  <p className="text-sm text-[hsl(215_16%_47%)]">Waiting for QR from Evolution…</p>
                )}
              </div>
            ) : null}

            <div className="grid gap-3 rounded-lg border border-[hsl(214_32%_88%)] p-3 md:grid-cols-2">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-[hsl(215_16%_40%)]">New instance name</span>
                <Input value={createName} onChange={(e) => setCreateName(e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[hsl(215_16%_40%)]">Mode</span>
                <Select value={mode} onChange={(e) => setMode(e.target.value as "baileys" | "cloud")}>
                  <option value="baileys">Baileys (QR / lab)</option>
                  <option value="cloud">Cloud (Meta / production buttons)</option>
                </Select>
              </label>
              {mode === "cloud" ? (
                <>
                  <label className="space-y-1 text-sm">
                    <span className="text-[hsl(215_16%_40%)]">Meta access token</span>
                    <Input value={cloudToken} onChange={(e) => setCloudToken(e.target.value)} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-[hsl(215_16%_40%)]">Phone number ID</span>
                    <Input value={cloudNumber} onChange={(e) => setCloudNumber(e.target.value)} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-[hsl(215_16%_40%)]">WABA / business ID</span>
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

            <div className="grid gap-3 rounded-lg border border-[hsl(214_32%_88%)] p-3">
              <p className="text-sm font-medium">Test send (admin phone)</p>
              <label className="space-y-1 text-sm">
                <span className="text-[hsl(215_16%_40%)]">E.164 digits</span>
                <Input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="973501234567"
                  dir="ltr"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[hsl(215_16%_40%)]">Message (no emoji)</span>
                <Input value={testText} onChange={(e) => setTestText(e.target.value)} />
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={!activeName || !testPhone || testMut.isPending}
                onClick={() => testMut.mutate()}
              >
                Send test
              </Button>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Recent webhook / send events</p>
              <div className="max-h-48 overflow-auto rounded border border-[hsl(214_32%_88%)] text-xs">
                {(eventsQ.data?.events ?? []).length === 0 ? (
                  <p className="p-3 text-[hsl(215_16%_47%)]">No events yet.</p>
                ) : (
                  <ul className="divide-y divide-[hsl(214_32%_91%)]">
                    {(eventsQ.data?.events ?? []).slice(0, 20).map((ev, idx) => (
                      <li key={`${ev.ts}-${idx}`} className="flex gap-2 px-3 py-2">
                        <span className="shrink-0 text-[hsl(215_16%_47%)]">
                          {new Date(ev.ts * 1000).toLocaleTimeString()}
                        </span>
                        <span className="font-medium">{ev.event_type}</span>
                        <span className="truncate text-[hsl(215_16%_40%)]">
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
      </CardContent>
    </Card>
  );
}
