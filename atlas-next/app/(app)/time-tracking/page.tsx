"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { api, download, errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/branding";
import { pickPrimaryCompany, pickPrimaryCompanyId } from "@/lib/company";
import { fmtDate, fmtDateTime, fmtPunchTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  connectionDraftError,
  connectionSaveBody,
  isCompanyId,
} from "@/lib/tt-connection";
import type { Employee } from "@/lib/types";
import { ExcelToolbar } from "@/components/excel-toolbar";

type TabId = "attendance" | "shifts" | "connection" | "alerts" | "calendar" | "logs";

interface AttendanceRow {
  id: string;
  employee_code: string;
  employee_name: string;
  department?: string;
  nationality?: string;
  reporting_to?: string;
  work_date: string;
  day?: string;
  shift_code?: string | null;
  first_in?: string | null;
  last_out?: string | null;
  worked_hours: number;
  late_minutes: number;
  late_clock?: string;
  early_out_minutes: number;
  overtime_minutes?: number;
  status: string;
}

type ShiftType = "regular" | "route";

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

type ManagerRow = {
  manager: string;
  employee_id: string | null;
  code: string;
  whatsapp: string;
  team_size: number;
};

interface ShiftRow {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  half_day_minutes: number;
  is_overnight: boolean;
  is_active: boolean;
  shift_type: ShiftType;
  weekly_off_days: string[];
  ot_enabled: boolean;
  ot_min_minutes: number;
  ot_max_minutes: number;
  ot_after_minutes: number;
  ot_before_shift: boolean;
}

interface EmpShiftRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  shift_id: string;
  shift_code: string;
  shift_name: string;
  shift_type?: ShiftType;
  effective_from: string;
  effective_to?: string | null;
}

interface HealthSnapshot {
  last_success_at?: string | null;
  consecutive_failures?: number;
  last_watermark?: number | null;
  alerts_sent_today?: number;
  alert_failures?: number;
  queue_depth?: number;
  next_run_hint?: string;
  last_scheduled_at?: string | null;
  last_scheduled_status?: string | null;
  scheduler?: {
    enabled?: boolean;
    running?: boolean;
    mode?: string;
    sync_interval_seconds?: number;
    alert_interval_seconds?: number;
    last_sync_at?: string | null;
    last_alert_at?: string | null;
  };
}

const EMPTY_SHIFT = {
  code: "",
  name: "",
  start_time: "08:00",
  end_time: "17:00",
  grace_minutes: 10,
  half_day_minutes: 240,
  is_overnight: false,
  is_active: true,
  shift_type: "regular" as ShiftType,
  weekly_off_days: ["FRI"] as string[],
  ot_enabled: false,
  ot_min_minutes: 30,
  ot_max_minutes: 0,
  ot_after_minutes: 0,
  ot_before_shift: false,
};

function fmtHoursMinutes(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function overtimeSummary(s: ShiftRow) {
  if (!s.ot_enabled) return "—";
  const after = s.ot_after_minutes ? `after ${fmtHoursMinutes(s.ot_after_minutes)}` : "after shift";
  const cap = s.ot_max_minutes ? `max ${fmtHoursMinutes(s.ot_max_minutes)}` : "no cap";
  return `${after} · min ${s.ot_min_minutes}m · ${cap}${s.ot_before_shift ? " · early in counts" : ""}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function TimeTrackingPage() {
  const t = useT();
  const qc = useQueryClient();
  const companies = useCompanies();
  const [companyId, setCompanyId] = useState("");
  const [tab, setTab] = useState<TabId>("attendance");
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [statusFilter, setStatusFilter] = useState("");
  const [department, setDepartment] = useState("");
  const [shiftForm, setShiftForm] = useState(EMPTY_SHIFT);
  const [editingShift, setEditingShift] = useState<ShiftRow | null>(null);
  const [showShift, setShowShift] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<EmpShiftRow | null>(null);
  const [showEditAssign, setShowEditAssign] = useState(false);
  const [showRouteDays, setShowRouteDays] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteScope, setDeleteScope] = useState<"route" | "all">("route");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [empSearch, setEmpSearch] = useState("");
  const [assignForm, setAssignForm] = useState({
    employee_ids: [] as string[],
    shift_id: "",
    effective_from: todayIso(),
    effective_to: "",
  });
  const [editAssignForm, setEditAssignForm] = useState({
    shift_id: "",
    effective_from: todayIso(),
    effective_to: "",
  });
  const [connForm, setConnForm] = useState({
    host: "",
    port: 1433,
    database_name: "",
    username: "",
    password: "",
    table_name: "esslpunchlog",
    lookback_hours: 48,
    is_active: true,
  });
  const [alertForm, setAlertForm] = useState({
    hr_whatsapp: "",
    escalation_whatsapp: "",
    digest_time: "09:30",
    batch_alerts: true,
    timezone: "Asia/Bahrain",
    wa_provider: "evolution" as const,
    alert_buffer_minutes: 15,
    late_after_minutes: 15,
  });
  const [calForm, setCalForm] = useState({
    exception_date: todayIso(),
    exception_type: "holiday" as "holiday" | "weekly_off",
    label: "",
  });

  const activeCompany = companyId || pickPrimaryCompanyId(companies.data);
  const activeCompanyMeta = useMemo(
    () => (companies.data ?? []).find((c) => c.id === activeCompany),
    [companies.data, activeCompany]
  );

  useEffect(() => {
    if (companyId) return;
    const list = companies.data ?? [];
    if (!list.length) return;
    const preferred = pickPrimaryCompany(list);
    if (preferred?.id) setCompanyId(preferred.id);
  }, [companies.data, companyId]);

  useEffect(() => {
    // Reset draft when company changes so we never save another company's blank form
    setConnForm({
      host: "",
      port: 1433,
      database_name: "",
      username: "",
      password: "",
      table_name: "esslpunchlog",
      lookback_hours: 48,
      is_active: true,
    });
  }, [activeCompany]);

  const health = useQuery({
    queryKey: ["tt-health", activeCompany],
    enabled: !!activeCompany,
    queryFn: () => api<HealthSnapshot>(`/time-tracking/health?company_id=${activeCompany}`),
    refetchInterval: 60_000,
  });

  const days = useQuery({
    queryKey: ["tt-days", activeCompany, dateFrom, dateTo, statusFilter, department],
    enabled: !!activeCompany && tab === "attendance",
    queryFn: () => {
      const qs = new URLSearchParams({
        company_id: activeCompany,
        date_from: dateFrom,
        date_to: dateTo,
        limit: "500",
      });
      if (statusFilter) qs.set("status", statusFilter);
      if (department.trim()) qs.set("department", department.trim());
      return api<{ count: number; rows: AttendanceRow[] }>(`/time-tracking/days?${qs}`);
    },
  });

  const shifts = useQuery({
    queryKey: ["tt-shifts", activeCompany],
    enabled: !!activeCompany && (tab === "shifts" || tab === "attendance"),
    queryFn: () => api<ShiftRow[]>(`/time-tracking/shifts?company_id=${activeCompany}`),
  });

  const employees = useQuery({
    queryKey: ["tt-employees", activeCompany],
    enabled: !!activeCompany && tab === "shifts",
    queryFn: async () => {
      const rows = await api<Employee[]>("/employees?limit=500&sort_by=code");
      return rows.filter((e) => e.company_id === activeCompany && e.active);
    },
  });

  const empShifts = useQuery({
    queryKey: ["tt-emp-shifts", activeCompany],
    enabled: !!activeCompany && tab === "shifts",
    queryFn: () => api<EmpShiftRow[]>(`/time-tracking/employee-shifts?company_id=${activeCompany}`),
  });

  const activeShifts = useMemo(
    () => (shifts.data ?? []).filter((s) => s.is_active),
    [shifts.data]
  );

  const routeDayCount = useMemo(
    () => (empShifts.data ?? []).filter((a) => a.shift_type === "route").length,
    [empShifts.data]
  );

  const visibleAssignments = useMemo(
    () => (empShifts.data ?? []).filter((a) => showRouteDays || a.shift_type !== "route"),
    [empShifts.data, showRouteDays]
  );

  const filteredEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    const rows = employees.data ?? [];
    if (!q) return rows;
    return rows.filter(
      (e) =>
        e.code.toLowerCase().includes(q) ||
        e.full_name.toLowerCase().includes(q) ||
        (e.department || "").toLowerCase().includes(q)
    );
  }, [employees.data, empSearch]);

  const selectedEmployees = useMemo(() => {
    const set = new Set(assignForm.employee_ids);
    return (employees.data ?? []).filter((e) => set.has(e.id));
  }, [employees.data, assignForm.employee_ids]);

  const openAssignDialog = () => {
    setEmpSearch("");
    setAssignForm({
      employee_ids: [],
      shift_id: activeShifts[0]?.id ?? "",
      effective_from: todayIso(),
      effective_to: "",
    });
    setShowAssign(true);
  };

  const openEditAssignDialog = (row: EmpShiftRow) => {
    setEditingAssignment(row);
    setEditAssignForm({
      shift_id: row.shift_id,
      effective_from: row.effective_from,
      effective_to: row.effective_to ?? "",
    });
    setShowEditAssign(true);
  };

  const toggleEmployee = (id: string) => {
    setAssignForm((f) => {
      const has = f.employee_ids.includes(id);
      return {
        ...f,
        employee_ids: has ? f.employee_ids.filter((x) => x !== id) : [...f.employee_ids, id],
      };
    });
  };

  const selectAllFiltered = () => {
    const ids = filteredEmployees.map((e) => e.id);
    setAssignForm((f) => ({
      ...f,
      employee_ids: Array.from(new Set([...f.employee_ids, ...ids])),
    }));
  };

  const clearSelection = () => setAssignForm((f) => ({ ...f, employee_ids: [] }));

  const connection = useQuery({
    queryKey: ["tt-connection", activeCompany],
    enabled: !!activeCompany && tab === "connection" && isCompanyId(activeCompany),
    queryFn: async () => {
      const data = await api<Record<string, unknown>>(`/time-tracking/connection?company_id=${activeCompany}`);
      if (data.configured) {
        setConnForm({
          host: String(data.host ?? ""),
          port: Number(data.port ?? 1433),
          database_name: String(data.database_name ?? ""),
          username: String(data.username ?? ""),
          password: data.password_set ? "********" : "",
          table_name: String(data.table_name ?? "esslpunchlog"),
          lookback_hours: Number(data.lookback_hours ?? 48),
          is_active: Boolean(data.is_active),
        });
      }
      return data;
    },
  });

  const connectionConfigured = Boolean(connection.data?.configured);
  const connectionReadyError = connectionDraftError(activeCompany, connForm, {
    configured: connectionConfigured,
  });
  const canSaveConnection = !connectionReadyError;

  const alertSettings = useQuery({
    queryKey: ["tt-alert-settings", activeCompany],
    enabled: !!activeCompany && (tab === "alerts" || tab === "shifts"),
    queryFn: async () => {
      const data = await api<typeof alertForm>(`/time-tracking/alert-settings?company_id=${activeCompany}`);
      setAlertForm({
        hr_whatsapp: data.hr_whatsapp ?? "",
        escalation_whatsapp: data.escalation_whatsapp ?? "",
        digest_time: data.digest_time ?? "09:30",
        batch_alerts: Boolean(data.batch_alerts),
        timezone: data.timezone ?? "Asia/Bahrain",
        wa_provider: "evolution",
        alert_buffer_minutes: Number(
          (data as { alert_buffer_minutes?: number }).alert_buffer_minutes ?? 15
        ),
        late_after_minutes: Number(data.late_after_minutes ?? 15),
      });
      return data;
    },
  });

  const alertRules = useQuery({
    queryKey: ["tt-alert-rules", activeCompany],
    enabled: !!activeCompany && tab === "alerts",
    queryFn: () => api<Array<Record<string, unknown>>>(`/time-tracking/alert-rules?company_id=${activeCompany}`),
  });

  const managers = useQuery({
    queryKey: ["tt-managers", activeCompany],
    enabled: !!activeCompany && tab === "alerts",
    queryFn: () => api<ManagerRow[]>(`/time-tracking/managers?company_id=${activeCompany}`),
  });
  const [managerDrafts, setManagerDrafts] = useState<Record<string, string>>({});
  const saveManagerWa = useMutation({
    mutationFn: (m: { employee_id: string; whatsapp: string }) =>
      api<{ whatsapp: string }>("/time-tracking/managers/whatsapp", {
        method: "PUT",
        body: { company_id: activeCompany, ...m },
      }),
    onSuccess: (res, m) => {
      toast.success("Manager WhatsApp saved", res.whatsapp || "Removed");
      setManagerDrafts((d) => {
        const next = { ...d };
        delete next[m.employee_id];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["tt-managers", activeCompany] });
    },
    onError: (err) => toast.error("Could not save manager WhatsApp", errorMessage(err)),
  });

  const calendar = useQuery({
    queryKey: ["tt-calendar", activeCompany],
    enabled: !!activeCompany && tab === "calendar",
    queryFn: () =>
      api<Array<{ id: string; exception_date: string; exception_type: string; label: string }>>(
        `/time-tracking/calendar?company_id=${activeCompany}&year=${new Date().getFullYear()}`
      ),
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      api(`/time-tracking/sync?company_id=${activeCompany}`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("Sync complete");
      qc.invalidateQueries({ queryKey: ["tt-days"] });
      qc.invalidateQueries({ queryKey: ["tt-health"] });
    },
    onError: (err) => toast.error("Sync failed", errorMessage(err)),
  });

  const recomputeMutation = useMutation({
    mutationFn: () =>
      api(`/time-tracking/recompute?company_id=${activeCompany}&work_date=${dateFrom}`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("Recomputed");
      qc.invalidateQueries({ queryKey: ["tt-days"] });
    },
    onError: (err) => toast.error("Recompute failed", errorMessage(err)),
  });

  const saveShift = useMutation({
    mutationFn: () => {
      const body = { company_id: activeCompany, ...shiftForm };
      if (editingShift) {
        return api(`/time-tracking/shifts/${editingShift.id}`, { method: "PUT", body });
      }
      return api("/time-tracking/shifts", { method: "POST", body });
    },
    onSuccess: () => {
      toast.success(editingShift ? "Shift updated" : "Shift created");
      setShowShift(false);
      setEditingShift(null);
      qc.invalidateQueries({ queryKey: ["tt-shifts"] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const deleteShift = useMutation({
    mutationFn: (id: string) => api(`/time-tracking/shifts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Shift deactivated");
      qc.invalidateQueries({ queryKey: ["tt-shifts"] });
    },
    onError: (err) => toast.error("Delete failed", errorMessage(err)),
  });

  const assignShift = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; assigned: number; skipped: number }>("/time-tracking/employee-shifts/bulk", {
        method: "POST",
        body: {
          company_id: activeCompany,
          employee_ids: assignForm.employee_ids,
          shift_id: assignForm.shift_id,
          effective_from: assignForm.effective_from,
          effective_to: assignForm.effective_to.trim() || null,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        `Assigned shift to ${res.assigned} employee${res.assigned === 1 ? "" : "s"}` +
          (res.skipped ? ` (${res.skipped} skipped)` : "")
      );
      setShowAssign(false);
      setEmpSearch("");
      setAssignForm({
        employee_ids: [],
        shift_id: "",
        effective_from: todayIso(),
        effective_to: "",
      });
      qc.invalidateQueries({ queryKey: ["tt-emp-shifts"] });
      qc.invalidateQueries({ queryKey: ["tt-days"] });
    },
    onError: (err) => toast.error("Assign failed", errorMessage(err)),
  });

  const updateAssignment = useMutation({
    mutationFn: () => {
      if (!editingAssignment) throw new Error("No assignment selected");
      return api(`/time-tracking/employee-shifts/${editingAssignment.id}`, {
        method: "PUT",
        body: {
          shift_id: editAssignForm.shift_id,
          effective_from: editAssignForm.effective_from,
          effective_to: editAssignForm.effective_to.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Assignment updated");
      setShowEditAssign(false);
      setEditingAssignment(null);
      qc.invalidateQueries({ queryKey: ["tt-emp-shifts"] });
      qc.invalidateQueries({ queryKey: ["tt-days"] });
    },
    onError: (err) => toast.error("Update failed", errorMessage(err)),
  });

  const unassignShift = useMutation({
    mutationFn: (id: string) => api(`/time-tracking/employee-shifts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Assignment removed");
      qc.invalidateQueries({ queryKey: ["tt-emp-shifts"] });
      qc.invalidateQueries({ queryKey: ["tt-days"] });
    },
    onError: (err) => toast.error("Remove failed", errorMessage(err)),
  });

  const deleteAllAssignments = useMutation({
    mutationFn: () =>
      api<{ removed: number }>("/time-tracking/employee-shifts/delete-all", {
        method: "POST",
        body: { company_id: activeCompany, scope: deleteScope, confirm: deleteConfirm },
      }),
    onSuccess: (res) => {
      toast.success(
        `${res.removed} ${deleteScope === "route" ? "route shift" : "shift"} assignment${res.removed === 1 ? "" : "s"} deleted`
      );
      setShowDeleteAll(false);
      setDeleteConfirm("");
      qc.invalidateQueries({ queryKey: ["tt-emp-shifts"] });
      qc.invalidateQueries({ queryKey: ["tt-days"] });
    },
    onError: (err) => toast.error("Delete failed", errorMessage(err)),
  });

  const saveConnection = useMutation({
    mutationFn: () => {
      const err = connectionDraftError(activeCompany, connForm, { configured: connectionConfigured });
      if (err) throw new Error(err);
      return api("/time-tracking/connection", {
        method: "PUT",
        body: connectionSaveBody(activeCompany, connForm),
      });
    },
    onSuccess: () => {
      toast.success("Connection saved");
      qc.invalidateQueries({ queryKey: ["tt-connection"] });
      qc.invalidateQueries({ queryKey: ["tt-health"] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const testConnection = useMutation({
    mutationFn: () => {
      const err = connectionDraftError(activeCompany, connForm, { configured: connectionConfigured });
      if (err) throw new Error(err);
      const body = connectionSaveBody(activeCompany, connForm);
      return api<{ ok: boolean; message?: string; error?: string }>("/time-tracking/connection/test", {
        method: "POST",
        body: {
          company_id: body.company_id,
          host: body.host,
          port: body.port,
          database_name: body.database_name,
          username: body.username,
          password: body.password || (connectionConfigured ? "********" : ""),
          table_name: body.table_name,
          trust_server_certificate: true,
        },
      });
    },
    onSuccess: (res) => {
      if (res.ok) toast.success(res.message || "Connection successful");
      else {
        const hint = (res as { hint?: string }).hint;
        toast.error("Connection failed", [res.error, hint].filter(Boolean).join(" — ") || "Unknown error");
      }
    },
    onError: (err) => toast.error("Connection failed", errorMessage(err)),
  });

  const syncRuns = useQuery({
    queryKey: ["tt-sync-runs", activeCompany],
    enabled: !!activeCompany && tab === "logs",
    queryFn: () => api<Array<Record<string, unknown>>>(`/time-tracking/sync-runs?company_id=${activeCompany}&limit=50`),
  });

  const alertLogs = useQuery({
    queryKey: ["tt-alert-logs", activeCompany],
    enabled: !!activeCompany && tab === "logs",
    queryFn: () => api<Array<Record<string, unknown>>>(`/time-tracking/alert-logs?company_id=${activeCompany}&limit=100`),
  });

  const healWa = useMutation({
    mutationFn: () => api<Record<string, unknown>>("/time-tracking/whatsapp/heal", { method: "POST" }),
    onSuccess: (res) => {
      if (res.ready) {
        toast.success(`Evolution ready (${String(res.instance || "")})`);
        return;
      }
      const steps = Array.isArray(res.admin_action) ? res.admin_action.map(String).slice(0, 2).join(" · ") : "";
      toast.error(
        "Evolution not ready — scan QR",
        steps || String(res.error || "Open Settings → WhatsApp, Connect, scan QR, then retry")
      );
      qc.invalidateQueries({ queryKey: ["wa-qr"] });
      qc.invalidateQueries({ queryKey: ["wa-instances"] });
    },
    onError: (err) => toast.error("Heal failed", errorMessage(err)),
  });

  const saveAlerts = useMutation({
    mutationFn: () =>
      api("/time-tracking/alert-settings", {
        method: "PUT",
        body: { company_id: activeCompany, ...alertForm },
      }),
    onSuccess: () => {
      toast.success("Alert settings saved");
      qc.invalidateQueries({ queryKey: ["tt-alert-settings", activeCompany] });
      qc.invalidateQueries({ queryKey: ["tt-alert-rules", activeCompany] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const processQueue = useMutation({
    mutationFn: () =>
      api<{ sent?: number; failed?: number; skipped?: number }>("/time-tracking/alerts/process-queue", {
        method: "POST",
      }),
    onSuccess: (res) => {
      toast.success(`Queue processed — sent ${res.sent ?? 0}, failed ${res.failed ?? 0}`);
      qc.invalidateQueries({ queryKey: ["tt-health"] });
      qc.invalidateQueries({ queryKey: ["tt-alert-logs"] });
    },
    onError: (err) => toast.error("Queue failed", errorMessage(err)),
  });

  const runSchedulerTick = useMutation({
    mutationFn: () =>
      api<{ ok?: boolean; sync?: { ok?: boolean }; alerts?: { ok?: boolean } }>(
        "/time-tracking/scheduler/tick?sync=true&alerts=true",
        { method: "POST" }
      ),
    onSuccess: (res) => {
      toast.success(
        `Auto tick done — sync ${res.sync?.ok ? "ok" : "check"} · alerts ${res.alerts?.ok ? "ok" : "check"}`
      );
      qc.invalidateQueries({ queryKey: ["tt-health"] });
      qc.invalidateQueries({ queryKey: ["tt-sync-runs"] });
      qc.invalidateQueries({ queryKey: ["tt-alert-logs"] });
      qc.invalidateQueries({ queryKey: ["tt-days"] });
    },
    onError: (err) => toast.error("Scheduler tick failed", errorMessage(err)),
  });

  const sendTestWa = useMutation({
    mutationFn: () =>
      api<{
        ok?: boolean;
        results?: Array<{ to: string; role: string; ok: boolean; error?: string; rows?: number }>;
        sample_employee?: string;
        hint?: string;
        format?: string;
        hr_rows?: number;
        rm_rows?: number;
        settings_saved?: boolean;
        hr_whatsapp?: string;
      }>(
        `/time-tracking/alerts/test-send?company_id=${encodeURIComponent(activeCompany)}` +
          `&hr_whatsapp=${encodeURIComponent(alertForm.hr_whatsapp.trim())}` +
          (alertForm.escalation_whatsapp.trim()
            ? `&escalation_whatsapp=${encodeURIComponent(alertForm.escalation_whatsapp.trim())}`
            : ""),
        {
          method: "POST",
          body: {
            company_id: activeCompany,
            hr_whatsapp: alertForm.hr_whatsapp,
            escalation_whatsapp: alertForm.escalation_whatsapp,
            digest_time: alertForm.digest_time,
            batch_alerts: alertForm.batch_alerts,
            timezone: alertForm.timezone,
            alert_buffer_minutes: alertForm.alert_buffer_minutes,
            late_after_minutes: alertForm.late_after_minutes,
          },
        }
      ),
    onSuccess: (res) => {
      const parts = (res.results ?? []).map(
        (r) =>
          `${r.role === "rm" ? "Manager" : "HR"} ${r.to}: ${r.ok ? `${r.rows ?? 0} people` : r.error || "fail"}`
      );
      const savedHr = res.settings_saved && res.hr_whatsapp ? `saved HR ${res.hr_whatsapp}` : "";
      if (res.ok) {
        toast.success(
          "Test WhatsApp sent",
          [savedHr, parts.join(" · "), res.hint].filter(Boolean).join(" · ")
        );
      } else {
        toast.error("Test WhatsApp failed", parts.join(" · ") || "Check Evolution / numbers");
      }
      qc.invalidateQueries({ queryKey: ["tt-alert-settings", activeCompany] });
      qc.invalidateQueries({ queryKey: ["tt-alert-logs"] });
      qc.invalidateQueries({ queryKey: ["tt-health"] });
    },
    onError: (err) => toast.error("Test WhatsApp failed", errorMessage(err)),
  });

  const addCalendar = useMutation({
    mutationFn: () =>
      api("/time-tracking/calendar", {
        method: "POST",
        body: { company_id: activeCompany, ...calForm },
      }),
    onSuccess: () => {
      toast.success("Calendar exception added");
      qc.invalidateQueries({ queryKey: ["tt-calendar"] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const deleteCalendar = useMutation({
    mutationFn: (id: string) => api(`/time-tracking/calendar/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["tt-calendar"] });
    },
    onError: (err) => toast.error("Delete failed", errorMessage(err)),
  });

  const summary = useMemo(() => {
    const rows = days.data?.rows ?? [];
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [days.data]);

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="time-tracking-page">
      <PageHeader
        title={t("page.timeTracking.title")}
        subtitle={t("page.timeTracking.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Company"
              value={isCompanyId(activeCompany) ? activeCompany : ""}
              onChange={(e) => setCompanyId(e.target.value)}
              className="min-w-0 w-full sm:min-w-[180px] sm:w-auto"
              data-testid="tt-company"
            >
              {!isCompanyId(activeCompany) && (
                <option value="" disabled>
                  {companies.isPending ? "Loading companies…" : "Select company…"}
                </option>
              )}
              {(companies.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              onClick={() => recomputeMutation.mutate()}
              disabled={!activeCompany || recomputeMutation.isPending}
            >
              <RefreshCw size={15} /> Refresh
            </Button>
            <Button
              variant="gradient"
              onClick={() => syncMutation.mutate()}
              disabled={!activeCompany || syncMutation.isPending}
              data-testid="tt-sync-now"
            >
              <Clock size={15} /> Sync now
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-4 py-3 text-sm">
          <span>
            Last sync:{" "}
            <strong>{fmtDateTime(health.data?.last_success_at)}</strong>
          </span>
          <span>
            Failures: <strong>{health.data?.consecutive_failures ?? 0}</strong>
          </span>
          <span>
            Alerts today: <strong>{health.data?.alerts_sent_today ?? 0}</strong>
          </span>
          <span>
            WA queue: <strong>{health.data?.queue_depth ?? 0}</strong>
          </span>
          <span data-testid="tt-auto-sync-status">
            Auto sync:{" "}
            <strong>
              {health.data?.scheduler?.running
                ? `ON · every ${health.data.scheduler.sync_interval_seconds ?? 300}s`
                : health.data?.scheduler?.enabled
                  ? "starting…"
                  : "OFF"}
            </strong>
            {health.data?.last_scheduled_at
              ? ` · last schedule ${fmtDateTime(health.data.last_scheduled_at)}`
              : ""}
          </span>
          <span className="text-[var(--color-muted-foreground)]" data-testid="tt-next-run-hint">
            {health.data?.next_run_hint ?? "In-process auto sync + WA queue"}
          </span>
        </CardContent>
      </Card>

      <Tabs
        tabs={[
          { id: "attendance", label: "Attendance" },
          { id: "shifts", label: "Shifts" },
          { id: "connection", label: "Biometric" },
          { id: "alerts", label: "WhatsApp alerts" },
          { id: "calendar", label: "Calendar" },
          { id: "logs", label: "Logs" },
        ]}
        active={tab}
        onChange={(id) => setTab(id as TabId)}
        className="mb-4"
      />

      {tab === "attendance" && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 shrink">
              <CardTitle>Daily grid</CardTitle>
              <CardDescription>
                {Object.entries(summary)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ") || "No rows"}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-2" data-testid="tt-daily-filters">
              <Field label="From" className="min-w-[9.5rem]">
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </Field>
              <Field label="To" className="min-w-[9.5rem]">
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </Field>
              <Field label="Department" className="min-w-[10rem]">
                <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="All" />
              </Field>
              <Field label="Status" className="min-w-[10rem]">
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All</option>
                  {["Present", "Late", "Absent", "Absent (Pending)", "Missing Punch", "Half Day", "Weekly Off", "Holiday", "No Shift"].map(
                    (s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    )
                  )}
                </Select>
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="h-10"
                  onClick={() =>
                    download(
                      `/time-tracking/report.xlsx?company_id=${activeCompany}&date_from=${dateFrom}&date_to=${dateTo}&department=${encodeURIComponent(department)}&status=${encodeURIComponent(statusFilter)}`,
                      "hcm-attendance.xlsx"
                    )
                  }
                >
                  <Download size={15} /> Excel
                </Button>
                <Button
                  variant="outline"
                  className="h-10"
                  onClick={() =>
                    download(
                      `/time-tracking/report.pdf?company_id=${activeCompany}&date_from=${dateFrom}&date_to=${dateTo}&department=${encodeURIComponent(department)}&status=${encodeURIComponent(statusFilter)}`,
                      "hcm-attendance.pdf"
                    )
                  }
                >
                  <Download size={15} /> PDF
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {days.isPending ? (
              <TableSkeleton columns={12} rows={8} label={t("state.loading")} />
            ) : days.isError ? (
              <ErrorState error={days.error} onRetry={() => days.refetch()} />
            ) : !(days.data?.rows.length) ? (
              <EmptyState title="No attendance rows" message="Sync punches or adjust filters." />
            ) : (
              <Table stickyFirst data-testid="tt-daily-grid">
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Code</TH>
                    <TH>Date</TH>
                    <TH>Day</TH>
                    <TH>Shift</TH>
                    <TH>Time in</TH>
                    <TH>Time out</TH>
                    <TH>Late</TH>
                    <TH>OT</TH>
                    <TH>Status</TH>
                    <TH>Reporting to</TH>
                    <TH>Department</TH>
                    <TH>Nationality</TH>
                  </TR>
                </THead>
                <TBody>
                  {days.data.rows.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-medium whitespace-normal break-words">{r.employee_name}</TD>
                      <TD>{r.employee_code}</TD>
                      <TD className="whitespace-nowrap">{fmtDate(r.work_date)}</TD>
                      <TD>{r.day ?? "—"}</TD>
                      <TD>{r.shift_code ?? "—"}</TD>
                      <TD>{fmtPunchTime(r.first_in)}</TD>
                      <TD>{fmtPunchTime(r.last_out)}</TD>
                      <TD>{r.late_clock ?? r.late_minutes}</TD>
                      <TD>{r.overtime_minutes ? fmtHoursMinutes(r.overtime_minutes) : "—"}</TD>
                      <TD>
                        <Badge>{r.status}</Badge>
                      </TD>
                      <TD>{r.reporting_to || "—"}</TD>
                      <TD>{r.department || "—"}</TD>
                      <TD>{r.nationality || "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "shifts" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base sm:text-lg">Shift master</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Company shifts. Shifts may share hours; each employee follows the shift assigned to them.
                  Late rule for every shift: clocking in more than {alertForm.late_after_minutes} min after shift
                  start is Late, counted from shift start (change it under Alerts).
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <ExcelToolbar dataset="tt-shifts" />
                <Button
                  variant="outline"
                  className="h-10"
                  disabled={!activeShifts.length}
                  onClick={openAssignDialog}
                  data-testid="tt-assign-open-master"
                >
                  <UserPlus size={15} /> Assign shift
                </Button>
                <Button
                  variant="gradient"
                  className="h-10"
                  onClick={() => {
                    setEditingShift(null);
                    setShiftForm(EMPTY_SHIFT);
                    setShowShift(true);
                  }}
                >
                  <Plus size={15} /> New shift
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {shifts.isPending ? (
                <TableSkeleton label={t("state.loading")} />
              ) : !(shifts.data?.length) ? (
                <EmptyState title="No shifts" message="Create the first shift for this company." />
              ) : (
                <Table stickyFirst>
                  <THead>
                    <TR>
                      <TH>Code</TH>
                      <TH>Name</TH>
                      <TH>Start</TH>
                      <TH>End</TH>
                      <TH>Half-day</TH>
                      <TH>Type</TH>
                      <TH>Weekly off</TH>
                      <TH>Overtime</TH>
                      <TH>Flags</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {shifts.data.map((s) => (
                      <TR key={s.id}>
                        <TD>{s.code}</TD>
                        <TD>{s.name}</TD>
                        <TD>{s.start_time}</TD>
                        <TD>{s.end_time}</TD>
                        <TD>{s.half_day_minutes}m</TD>
                        <TD>{s.shift_type === "route" ? <Badge>Route</Badge> : "Regular"}</TD>
                        <TD>{s.weekly_off_days.length ? s.weekly_off_days.join(", ") : "—"}</TD>
                        <TD className="text-xs">{overtimeSummary(s)}</TD>
                        <TD>
                          {s.is_overnight ? "Overnight · " : ""}
                          {s.is_active ? "Active" : "Inactive"}
                        </TD>
                        <TD className="space-x-2 text-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingShift(s);
                              setShiftForm({
                                code: s.code,
                                name: s.name,
                                start_time: s.start_time,
                                end_time: s.end_time,
                                grace_minutes: s.grace_minutes,
                                half_day_minutes: s.half_day_minutes,
                                is_overnight: s.is_overnight,
                                is_active: s.is_active,
                                shift_type: s.shift_type,
                                weekly_off_days: s.weekly_off_days,
                                ot_enabled: s.ot_enabled,
                                ot_min_minutes: s.ot_min_minutes,
                                ot_max_minutes: s.ot_max_minutes,
                                ot_after_minutes: s.ot_after_minutes,
                                ot_before_shift: s.ot_before_shift,
                              });
                              setShowShift(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => deleteShift.mutate(s.id)}>
                            <Trash2 size={14} />
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card data-testid="tt-assignments-card">
            <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base sm:text-lg">Employee shift assignments</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Effective-dated roster — Attendance uses the shift active for each work date. A dated route
                  shift day overrides the regular shift on that day only.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ExcelToolbar dataset="tt-roster" />
                {routeDayCount > 0 && (
                  <label className="inline-flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                    <input
                      type="checkbox"
                      checked={showRouteDays}
                      onChange={(e) => setShowRouteDays(e.target.checked)}
                      data-testid="tt-show-route-days"
                    />
                    Show route days ({routeDayCount})
                  </label>
                )}
                <Button
                  variant="outline"
                  className="h-10"
                  disabled={!(empShifts.data?.length)}
                  onClick={() => {
                    setDeleteScope(routeDayCount > 0 ? "route" : "all");
                    setDeleteConfirm("");
                    setShowDeleteAll(true);
                  }}
                  data-testid="tt-delete-all-open"
                >
                  <Trash2 size={15} /> Delete assignments
                </Button>
                <Button
                  variant="gradient"
                  className="h-10"
                  disabled={!activeShifts.length}
                  onClick={openAssignDialog}
                  data-testid="tt-assign-open"
                >
                  <UserPlus size={15} /> Assign shift
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {empShifts.isPending || employees.isPending ? (
                <TableSkeleton label={t("state.loading")} />
              ) : !(empShifts.data?.length) ? (
                <EmptyState
                  title="No assignments"
                  message="Assign an active shift to employees so Attendance can show shift codes and late/early."
                />
              ) : (
                <Table stickyFirst>
                  <THead>
                    <TR>
                      <TH className="w-[7rem]">Emp ID</TH>
                      <TH>Name</TH>
                      <TH>Shift</TH>
                      <TH className="w-[7.5rem]">From</TH>
                      <TH className="w-[7.5rem]">To</TH>
                      <TH className="w-[9rem] text-end">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {visibleAssignments.map((a) => (
                      <TR key={a.id} data-testid={`tt-assignment-row-${a.id}`}>
                        <TD className="font-mono text-xs tabular-nums text-[var(--color-muted-foreground)]">
                          {a.employee_code}
                        </TD>
                        <TD className="text-sm font-medium">{a.employee_name}</TD>
                        <TD className="text-sm">
                          <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                            {a.shift_code}
                          </span>{" "}
                          <span className="text-[var(--color-foreground)]">{a.shift_name}</span>
                          {a.shift_type === "route" && <Badge className="ms-2">Route day</Badge>}
                        </TD>
                        <TD className="font-mono text-xs tabular-nums">{fmtDate(a.effective_from)}</TD>
                        <TD className="font-mono text-xs tabular-nums text-[var(--color-muted-foreground)]">
                          {a.effective_to ? fmtDate(a.effective_to) : "open"}
                        </TD>
                        <TD className="text-end">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditAssignDialog(a)}
                              data-testid={`tt-assignment-edit-${a.id}`}
                              aria-label={`Edit assignment for ${a.employee_code}`}
                            >
                              <Pencil size={14} /> Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => unassignShift.mutate(a.id)}
                              data-testid={`tt-assignment-remove-${a.id}`}
                              aria-label={`Remove assignment for ${a.employee_code}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "connection" && (
        <Card>
          <CardHeader>
            <CardTitle>Biometric SQL connection</CardTitle>
            <CardDescription>
              Encrypted at rest on the server — password never shown in responses. Scoped to the company
              selected above.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="col-span-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 px-3 py-2 text-sm">
              <div>
                Company:{" "}
                <strong data-testid="tt-connection-company">
                  {activeCompanyMeta
                    ? `${activeCompanyMeta.code} — ${activeCompanyMeta.name}`
                    : companies.isPending
                      ? "Loading…"
                      : "None selected"}
                </strong>
              </div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                ID: {isCompanyId(activeCompany) ? activeCompany : "—"} ·{" "}
                {connectionConfigured ? "Saved connection loaded" : "Not configured yet"}
              </div>
            </div>
            {!isCompanyId(activeCompany) && (
              <div className="col-span-2">
                <ErrorState
                  error={new Error("Select a company in the header before configuring biometric SQL.")}
                />
              </div>
            )}
            {connection.isError && <ErrorState error={connection.error} onRetry={() => connection.refetch()} />}
            <Field label="Host / SQL Server IP">
              <Input
                value={connForm.host}
                onChange={(e) => setConnForm((f) => ({ ...f, host: e.target.value }))}
                placeholder="192.168.10.15"
                disabled={!isCompanyId(activeCompany)}
              />
            </Field>
            <Field label="Port">
              <Input
                type="number"
                value={connForm.port}
                onChange={(e) => setConnForm((f) => ({ ...f, port: Number(e.target.value) }))}
                placeholder="1433"
                disabled={!isCompanyId(activeCompany)}
              />
            </Field>
            <Field label="Database name (not the punch table)">
              <Input
                value={connForm.database_name}
                onChange={(e) => setConnForm((f) => ({ ...f, database_name: e.target.value }))}
                placeholder="etrimetracklite1"
                disabled={!isCompanyId(activeCompany)}
              />
            </Field>
            <Field label="Username (read-only in production)">
              <Input
                value={connForm.username}
                onChange={(e) => setConnForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="ro_tt_reader"
                disabled={!isCompanyId(activeCompany)}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={connForm.password}
                onChange={(e) => setConnForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={connectionConfigured ? "Leave ******** to keep" : "Required"}
                disabled={!isCompanyId(activeCompany)}
              />
            </Field>
            <Field label="Punch table name">
              <Input
                value={connForm.table_name}
                onChange={(e) => setConnForm((f) => ({ ...f, table_name: e.target.value }))}
                placeholder="esslpunchlog"
                disabled={!isCompanyId(activeCompany)}
              />
            </Field>
            <Field label="Lookback hours">
              <Input
                type="number"
                value={connForm.lookback_hours}
                onChange={(e) => setConnForm((f) => ({ ...f, lookback_hours: Number(e.target.value) }))}
                disabled={!isCompanyId(activeCompany)}
              />
            </Field>
            <Field label="Active">
              <Select
                value={connForm.is_active ? "true" : "false"}
                onChange={(e) => setConnForm((f) => ({ ...f, is_active: e.target.value === "true" }))}
                disabled={!isCompanyId(activeCompany)}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            </Field>
            {connectionReadyError && isCompanyId(activeCompany) && (
              <p className="col-span-2 text-sm text-[var(--color-destructive)]" data-testid="tt-connection-guard">
                {connectionReadyError}
              </p>
            )}
            <div className="col-span-2 flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (connectionReadyError) {
                    toast.error("Cannot test", connectionReadyError);
                    return;
                  }
                  testConnection.mutate();
                }}
                disabled={!canSaveConnection || testConnection.isPending}
                data-testid="tt-test-connection"
              >
                Test connection
              </Button>
              <Button
                variant="gradient"
                onClick={() => {
                  if (connectionReadyError) {
                    toast.error("Cannot save", connectionReadyError);
                    return;
                  }
                  saveConnection.mutate();
                }}
                disabled={!canSaveConnection || saveConnection.isPending}
                data-testid="tt-save-connection"
              >
                <Save size={15} /> Save connection
              </Button>
            </div>
            <p className="col-span-2 text-xs text-[var(--color-muted-foreground)]">
              Steps: select company → Host / Database / Username / Password →{" "}
              <strong>Test connection</strong> → <strong>Save</strong> → Sync now. ODBC Driver 18 uses
              Encrypt + TrustServerCertificate (lab). If Test fails with 18456, the SQL password is wrong;
              with 4060, the database name is wrong or the login has no access — verify the exact name in SSMS.
              Prefer a dedicated read-only SQL login (not sa) for online punch sync.
            </p>
          </CardContent>
        </Card>
      )}

      {tab === "alerts" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Company WhatsApp settings</CardTitle>
              <CardDescription>
                Short text messages. Each reporting manager gets only their own team first, then HR
                gets one summary grouped by manager. Sent at shift start + late rule + WA buffer.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
              {alertSettings.isError && (
                <ErrorState error={alertSettings.error} onRetry={() => alertSettings.refetch()} />
              )}
              <Field label="HR WhatsApp">
                <Input
                  value={alertForm.hr_whatsapp}
                  onChange={(e) => setAlertForm((f) => ({ ...f, hr_whatsapp: e.target.value }))}
                  placeholder="973…"
                  data-testid="tt-alert-hr-wa"
                />
              </Field>
              <Field label="Escalation WhatsApp">
                <Input
                  value={alertForm.escalation_whatsapp}
                  onChange={(e) => setAlertForm((f) => ({ ...f, escalation_whatsapp: e.target.value }))}
                />
              </Field>
              <Field
                label="Late after shift start (min)"
                hint="Company rule for every shift: clocking in more than this many minutes after shift start is Late, counted from shift start (default 15)."
              >
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={alertForm.late_after_minutes}
                  onChange={(e) =>
                    setAlertForm((f) => ({
                      ...f,
                      late_after_minutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)),
                    }))
                  }
                  data-testid="tt-alert-late-after-minutes"
                />
              </Field>
              <Field
                label="WA buffer after late rule (min)"
                hint="Extra wait after the late rule before WhatsApp late/no-show; 0 sends as soon as an employee is late."
              >
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={alertForm.alert_buffer_minutes}
                  onChange={(e) =>
                    setAlertForm((f) => ({
                      ...f,
                      alert_buffer_minutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)),
                    }))
                  }
                  data-testid="tt-alert-buffer-minutes"
                />
              </Field>
              <Field label="Digest time">
                <Input
                  value={alertForm.digest_time}
                  onChange={(e) => setAlertForm((f) => ({ ...f, digest_time: e.target.value }))}
                />
              </Field>
              <Field label="Timezone">
                <Input
                  value={alertForm.timezone}
                  onChange={(e) => setAlertForm((f) => ({ ...f, timezone: e.target.value }))}
                />
              </Field>
              <Field label="Provider">
                <Input value="Evolution API" disabled />
              </Field>
              <Field label="Batch alerts">
                <Select
                  value={alertForm.batch_alerts ? "true" : "false"}
                  onChange={(e) => setAlertForm((f) => ({ ...f, batch_alerts: e.target.value === "true" }))}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              </Field>
              <div className="col-span-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/25 px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                Example: shift 08:00, late rule {alertForm.late_after_minutes} min, buffer{" "}
                {alertForm.alert_buffer_minutes} min → WhatsApp at{" "}
                {(() => {
                  const m = 8 * 60 + alertForm.late_after_minutes + alertForm.alert_buffer_minutes;
                  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
                })()}
                . Messages: Late today → Still not in (+1 h) → Now clocked in, and No clock-out after
                shift end. Each person is reported once per message type per day.
              </div>
              <div className="col-span-2 flex flex-wrap gap-2">
                <Button variant="gradient" onClick={() => saveAlerts.mutate()} disabled={saveAlerts.isPending}>
                  <Save size={15} /> Save settings
                </Button>
                <Button
                  variant="gradient"
                  onClick={() => sendTestWa.mutate()}
                  disabled={
                    sendTestWa.isPending || !alertForm.hr_whatsapp.trim() || !isCompanyId(activeCompany)
                  }
                  data-testid="tt-send-test-wa"
                >
                  Send test WhatsApp
                </Button>
                <Button
                  variant="outline"
                  onClick={() => processQueue.mutate()}
                  disabled={processQueue.isPending}
                  data-testid="tt-process-wa-queue"
                >
                  Process WA queue
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runSchedulerTick.mutate()}
                  disabled={runSchedulerTick.isPending}
                  data-testid="tt-scheduler-tick"
                >
                  Run auto tick now
                </Button>
                <Button variant="outline" onClick={() => healWa.mutate()} disabled={healWa.isPending}>
                  Heal Evolution
                </Button>
              </div>
              <p className="col-span-2 text-xs text-[var(--color-muted-foreground)]" data-testid="tt-test-wa-help">
                <strong>Send test WhatsApp</strong> saves the numbers above, then sends a sample team
                message to one reporting manager (if a number is saved below) and the HR summary to{" "}
                {alertForm.hr_whatsapp || "the HR number"}. Process WA queue sends pending messages
                (also automatic every {health.data?.scheduler?.alert_interval_seconds ?? 60}s).
              </p>
            </CardContent>
          </Card>
          <Card data-testid="tt-managers-card">
            <CardHeader>
              <CardTitle>Reporting managers</CardTitle>
              <CardDescription>
                From each employee&apos;s &quot;Reporting to&quot;. Managers with a WhatsApp number get
                their team&apos;s message first; the rest are only in the HR summary.
                {managers.data && (
                  <>
                    {" "}
                    {managers.data.filter((m) => m.whatsapp).length} of {managers.data.length} managers
                    have WhatsApp.
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {managers.isError ? (
                <ErrorState error={managers.error} onRetry={() => managers.refetch()} />
              ) : managers.isLoading ? (
                <TableSkeleton rows={4} />
              ) : !managers.data?.length ? (
                <EmptyState
                  title="No reporting managers"
                  message="Set Reporting to on employees to send team reports to managers."
                />
              ) : (
                <Table cards>
                  <THead>
                    <TR>
                      <TH>Manager</TH>
                      <TH>Team</TH>
                      <TH>WhatsApp</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {managers.data.map((m) => {
                      const draft = m.employee_id ? managerDrafts[m.employee_id] : undefined;
                      const value = draft ?? m.whatsapp;
                      return (
                        <TR key={m.manager}>
                          <TD className="font-medium whitespace-normal break-words">
                            {m.manager}
                            {m.code ? (
                              <span className="ms-1 text-xs text-[var(--color-muted-foreground)]">({m.code})</span>
                            ) : null}
                          </TD>
                          <TD>{m.team_size}</TD>
                          <TD>
                            {m.employee_id ? (
                              <Input
                                value={value}
                                placeholder="973…"
                                inputMode="tel"
                                className="max-w-[180px]"
                                onChange={(e) =>
                                  setManagerDrafts((d) => ({ ...d, [m.employee_id as string]: e.target.value }))
                                }
                                aria-label={`WhatsApp for ${m.manager}`}
                              />
                            ) : (
                              <Badge variant="warning">Not an employee — HR only</Badge>
                            )}
                          </TD>
                          <TD>
                            {m.employee_id && draft !== undefined && draft !== m.whatsapp ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={saveManagerWa.isPending}
                                onClick={() =>
                                  saveManagerWa.mutate({ employee_id: m.employee_id as string, whatsapp: draft })
                                }
                              >
                                <Save size={14} /> Save
                              </Button>
                            ) : m.whatsapp ? (
                              <Badge variant="success">Gets team report</Badge>
                            ) : null}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Escalation matrix</CardTitle>
              <CardDescription>Default ladder seeded on first connection/settings save</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table cards>
                <THead>
                  <TR>
                    <TH>Type</TH>
                    <TH>Anchor</TH>
                    <TH>Offset (min)</TH>
                    <TH>Recipients</TH>
                    <TH>Template</TH>
                    <TH>Active</TH>
                  </TR>
                </THead>
                <TBody>
                  {(alertRules.data ?? []).map((r) => (
                    <TR key={String(r.id)}>
                      <TD>{String(r.alert_type)}</TD>
                      <TD>{String(r.anchor)}</TD>
                      <TD>{String(r.offset_minutes)}</TD>
                      <TD>{String(r.recipients)}</TD>
                      <TD>{String(r.template_key)}</TD>
                      <TD>{r.is_active ? "Yes" : "No"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "logs" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
              <div>
                <CardTitle>Sync log</CardTitle>
                <CardDescription>
                  Auto runs use trigger <code>schedule</code>; Sync now uses <code>manual</code>
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  className="h-10"
                  variant="outline"
                  onClick={() => runSchedulerTick.mutate()}
                  disabled={runSchedulerTick.isPending}
                  data-testid="tt-logs-scheduler-tick"
                >
                  Run auto tick now
                </Button>
                <Button
                  className="h-10"
                  variant="outline"
                  onClick={() => processQueue.mutate()}
                  disabled={processQueue.isPending}
                  data-testid="tt-logs-process-wa"
                >
                  Process WA queue
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {syncRuns.isPending ? (
                <TableSkeleton label={t("state.loading")} />
              ) : !(syncRuns.data?.length) ? (
                <EmptyState
                  title="No sync runs yet"
                  message="Use Sync now or wait for in-process auto sync (every 5 min)."
                />
              ) : (
                <Table cards>
                  <THead>
                    <TR>
                      <TH>Started</TH>
                      <TH>Trigger</TH>
                      <TH>Status</TH>
                      <TH>Fetched</TH>
                      <TH>Ins/Upd/Skip/Rej</TH>
                      <TH>Watermark</TH>
                      <TH>Error</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {syncRuns.data.map((r) => (
                      <TR key={String(r.id)}>
                        <TD className="whitespace-nowrap">{fmtDateTime(r.started_at)}</TD>
                        <TD>{String(r.trigger)}</TD>
                        <TD>
                          <Badge>{String(r.status)}</Badge>
                        </TD>
                        <TD>{String(r.fetched)}</TD>
                        <TD>
                          {String(r.inserted)}/{String(r.updated)}/{String(r.skipped)}/{String(r.rejected)}
                        </TD>
                        <TD>
                          {String(r.watermark_before)}→{String(r.watermark_after)}
                        </TD>
                        <TD className="max-w-[220px] truncate text-xs">{String(r.error_message || "—")}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Alert log</CardTitle>
              <CardDescription>Escalation / Resolved messages (Evolution) with de-dupe status</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {alertLogs.isPending ? (
                <TableSkeleton label={t("state.loading")} />
              ) : !(alertLogs.data?.length) ? (
                <EmptyState title="No alerts yet" message="Alerts enqueue after sync/recompute when rules fire." />
              ) : (
                <Table cards>
                  <THead>
                    <TR>
                      <TH>When</TH>
                      <TH>Type</TH>
                      <TH>Date</TH>
                      <TH>Recipient</TH>
                      <TH>Role</TH>
                      <TH>Status</TH>
                      <TH>Fallback</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {alertLogs.data.map((r) => (
                      <TR key={String(r.id)}>
                        <TD className="whitespace-nowrap">{fmtDateTime(r.created_at)}</TD>
                        <TD>{String(r.alert_type)}</TD>
                        <TD className="whitespace-nowrap">{fmtDate(r.work_date)}</TD>
                        <TD>{String(r.recipient)}</TD>
                        <TD>{String(r.recipient_role)}</TD>
                        <TD>
                          <Badge>{String(r.status)}</Badge>
                        </TD>
                        <TD>{r.fallback_used ? "Yes" : "No"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "calendar" && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Holidays & weekly offs</CardTitle>
              <CardDescription>Company calendar exceptions used by attendance status</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ExcelToolbar dataset="tt-calendar" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid max-w-2xl grid-cols-3 gap-3">
              <Field label="Date">
                <Input
                  type="date"
                  value={calForm.exception_date}
                  onChange={(e) => setCalForm((f) => ({ ...f, exception_date: e.target.value }))}
                />
              </Field>
              <Field label="Type">
                <Select
                  value={calForm.exception_type}
                  onChange={(e) =>
                    setCalForm((f) => ({
                      ...f,
                      exception_type: e.target.value as "holiday" | "weekly_off",
                    }))
                  }
                >
                  <option value="holiday">Holiday</option>
                  <option value="weekly_off">Weekly off</option>
                </Select>
              </Field>
              <Field label="Label">
                <Input value={calForm.label} onChange={(e) => setCalForm((f) => ({ ...f, label: e.target.value }))} />
              </Field>
            </div>
            <Button variant="gradient" onClick={() => addCalendar.mutate()}>
              <Plus size={15} /> Add exception
            </Button>
            <Table cards>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH>Label</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {(calendar.data ?? []).map((c) => (
                  <TR key={c.id}>
                    <TD>{fmtDate(c.exception_date)}</TD>
                    <TD>{c.exception_type}</TD>
                    <TD>{c.label || "—"}</TD>
                    <TD className="text-end">
                      <Button size="sm" variant="outline" onClick={() => deleteCalendar.mutate(c.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={showShift}
        onClose={() => setShowShift(false)}
        title={editingShift ? "Edit shift" : "New shift"}
        footer={
          <Button variant="gradient" onClick={() => saveShift.mutate()} disabled={saveShift.isPending}>
            <Save size={15} /> Save
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <Input value={shiftForm.code} onChange={(e) => setShiftForm((f) => ({ ...f, code: e.target.value }))} />
          </Field>
          <Field label="Name">
            <Input value={shiftForm.name} onChange={(e) => setShiftForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Start">
            <Input
              value={shiftForm.start_time}
              onChange={(e) => setShiftForm((f) => ({ ...f, start_time: e.target.value }))}
              placeholder="08:00"
            />
          </Field>
          <Field label="End">
            <Input
              value={shiftForm.end_time}
              onChange={(e) => setShiftForm((f) => ({ ...f, end_time: e.target.value }))}
              placeholder="17:00"
            />
          </Field>
          <Field label="Half-day (min)">
            <Input
              type="number"
              value={shiftForm.half_day_minutes}
              onChange={(e) => setShiftForm((f) => ({ ...f, half_day_minutes: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Overnight">
            <Select
              value={shiftForm.is_overnight ? "true" : "false"}
              onChange={(e) => setShiftForm((f) => ({ ...f, is_overnight: e.target.value === "true" }))}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </Select>
          </Field>
          <Field label="Active">
            <Select
              value={shiftForm.is_active ? "true" : "false"}
              onChange={(e) => setShiftForm((f) => ({ ...f, is_active: e.target.value === "true" }))}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </Field>
          <Field label="Shift type">
            <Select
              value={shiftForm.shift_type}
              onChange={(e) => setShiftForm((f) => ({ ...f, shift_type: e.target.value as ShiftType }))}
              data-testid="tt-shift-type"
            >
              <option value="regular">Regular</option>
              <option value="route">Route (single days on top of the regular shift)</option>
            </Select>
          </Field>
          <Field label="Weekly off">
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2" data-testid="tt-shift-weekly-off">
              {WEEKDAYS.map((d) => (
                <label key={d} className="inline-flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={shiftForm.weekly_off_days.includes(d)}
                    onChange={(e) =>
                      setShiftForm((f) => ({
                        ...f,
                        weekly_off_days: e.target.checked
                          ? [...f.weekly_off_days, d]
                          : f.weekly_off_days.filter((x) => x !== d),
                      }))
                    }
                  />
                  {d.charAt(0) + d.slice(1).toLowerCase()}
                </label>
              ))}
            </div>
          </Field>
        </div>
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
          <label className="inline-flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={shiftForm.ot_enabled}
              onChange={(e) => setShiftForm((f) => ({ ...f, ot_enabled: e.target.checked }))}
              data-testid="tt-shift-ot-enabled"
            />
            Overtime
          </label>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
            Overtime counts after the worked minutes below (0 = shift length), from shift start unless early
            arrival counts. Less than the minimum is not paid; the maximum caps one day (0 = no cap). Work on a
            weekly off or holiday is all overtime.
          </p>
          {shiftForm.ot_enabled && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Starts after worked (min)">
                <Input
                  type="number"
                  min={0}
                  value={shiftForm.ot_after_minutes}
                  onChange={(e) => setShiftForm((f) => ({ ...f, ot_after_minutes: Number(e.target.value) }))}
                />
              </Field>
              <Field label="Minimum per day (min)">
                <Input
                  type="number"
                  min={0}
                  value={shiftForm.ot_min_minutes}
                  onChange={(e) => setShiftForm((f) => ({ ...f, ot_min_minutes: Number(e.target.value) }))}
                />
              </Field>
              <Field label="Maximum per day (min)">
                <Input
                  type="number"
                  min={0}
                  value={shiftForm.ot_max_minutes}
                  onChange={(e) => setShiftForm((f) => ({ ...f, ot_max_minutes: Number(e.target.value) }))}
                />
              </Field>
              <Field label="Early arrival counts">
                <Select
                  value={shiftForm.ot_before_shift ? "true" : "false"}
                  onChange={(e) => setShiftForm((f) => ({ ...f, ot_before_shift: e.target.value === "true" }))}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </Select>
              </Field>
            </div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={showDeleteAll}
        onClose={() => setShowDeleteAll(false)}
        title="Delete shift assignments"
        description="Removes assignments for this company. Attendance days without a shift show no late or early times."
        footer={
          <Button
            variant="gradient"
            onClick={() => deleteAllAssignments.mutate()}
            disabled={deleteAllAssignments.isPending || deleteConfirm.trim().toUpperCase() !== "DELETE"}
            data-testid="tt-delete-all-confirm"
          >
            <Trash2 size={15} /> Delete
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="What to delete">
            <Select
              value={deleteScope}
              onChange={(e) => setDeleteScope(e.target.value as "route" | "all")}
              data-testid="tt-delete-all-scope"
            >
              <option value="route">Route shift days only ({routeDayCount})</option>
              <option value="all">All shift assignments ({empShifts.data?.length ?? 0})</option>
            </Select>
          </Field>
          <Field label="Type DELETE to confirm">
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              data-testid="tt-delete-all-phrase"
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={showAssign}
        onClose={() => setShowAssign(false)}
        size="full"
        title="Assign shift"
        description="Big-screen multi-select — choose one shift, then tick many employees (Frappe HR / Talenta bulk pattern)."
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-[var(--color-muted-foreground)]" data-testid="tt-assign-count">
              {assignForm.employee_ids.length} selected
            </span>
            <Button
              variant="gradient"
              onClick={() => assignShift.mutate()}
              disabled={
                assignShift.isPending ||
                !assignForm.employee_ids.length ||
                !assignForm.shift_id ||
                !assignForm.effective_from
              }
              data-testid="tt-assign-save"
            >
              <Save size={15} /> Save assignment
              {assignForm.employee_ids.length > 0 ? ` (${assignForm.employee_ids.length})` : ""}
            </Button>
          </div>
        }
      >
        <div className="space-y-4" data-testid="tt-assign-multi">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Shift">
              <Select
                value={assignForm.shift_id}
                onChange={(e) => setAssignForm((f) => ({ ...f, shift_id: e.target.value }))}
                data-testid="tt-assign-shift"
              >
                <option value="">Select shift…</option>
                {activeShifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name} ({s.start_time}–{s.end_time})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Effective from">
              <Input
                type="date"
                value={assignForm.effective_from}
                onChange={(e) => setAssignForm((f) => ({ ...f, effective_from: e.target.value }))}
              />
            </Field>
            <Field label="Effective to (optional)">
              <Input
                type="date"
                value={assignForm.effective_to}
                onChange={(e) => setAssignForm((f) => ({ ...f, effective_to: e.target.value }))}
              />
            </Field>
          </div>

          <div className="grid min-h-[420px] gap-3 lg:grid-cols-2">
            <div className="flex flex-col rounded-[var(--radius-md)] border border-[var(--color-border)]">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] p-3">
                <Input
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="Search code, name, department…"
                  className="min-w-[180px] flex-1"
                  data-testid="tt-assign-search"
                />
                <Button type="button" size="sm" variant="outline" onClick={selectAllFiltered}>
                  Select all filtered
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={clearSelection}>
                  Clear
                </Button>
              </div>
              <div className="max-h-[52vh] flex-1 overflow-y-auto p-2">
                {employees.isPending ? (
                  <TableSkeleton label={t("state.loading")} />
                ) : !filteredEmployees.length ? (
                  <EmptyState title="No employees" message="Try another search or company." />
                ) : (
                  <ul className="space-y-0.5">
                    {filteredEmployees.map((e) => {
                      const checked = assignForm.employee_ids.includes(e.id);
                      return (
                        <li key={e.id}>
                          <label
                            className={`flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-sm hover:bg-[var(--color-secondary)] ${
                              checked ? "bg-[var(--color-secondary)]" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-[var(--color-primary)]"
                              checked={checked}
                              onChange={() => toggleEmployee(e.id)}
                              data-testid={`tt-assign-emp-${e.code}`}
                            />
                            <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                              {e.code}
                            </span>
                            <span className="flex-1 font-medium">{e.full_name}</span>
                            <span className="text-xs text-[var(--color-muted-foreground)]">
                              {e.department || "—"}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/20">
              <div className="border-b border-[var(--color-border)] px-3 py-2 text-sm font-semibold">
                Selected employees ({selectedEmployees.length})
              </div>
              <div className="max-h-[52vh] flex-1 overflow-y-auto p-2">
                {!selectedEmployees.length ? (
                  <p className="p-3 text-sm text-[var(--color-muted-foreground)]">
                    Tick employees on the left. They appear here as a bulk preview before save.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {selectedEmployees.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-white px-2 py-1.5 text-sm"
                      >
                        <span>
                          <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                            {e.code}
                          </span>{" "}
                          {e.full_name}
                        </span>
                        <Button type="button" size="sm" variant="outline" onClick={() => toggleEmployee(e.id)}>
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={showEditAssign}
        onClose={() => {
          setShowEditAssign(false);
          setEditingAssignment(null);
        }}
        size="wide"
        title="Edit shift assignment"
        description="Change shift or effective dates for this employee (Workday mass-change pattern — employee locked)."
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowEditAssign(false);
                setEditingAssignment(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="gradient"
              onClick={() => updateAssignment.mutate()}
              disabled={
                updateAssignment.isPending ||
                !editAssignForm.shift_id ||
                !editAssignForm.effective_from
              }
              data-testid="tt-edit-assign-save"
            >
              <Save size={15} /> Save changes
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2" data-testid="tt-edit-assign">
          <Field label="Employee">
            <Input
              readOnly
              value={
                editingAssignment
                  ? `${editingAssignment.employee_code} — ${editingAssignment.employee_name}`
                  : ""
              }
              className="bg-[var(--color-muted)]/40 font-medium"
              data-testid="tt-edit-assign-employee"
            />
          </Field>
          <Field label="Shift">
            <Select
              value={editAssignForm.shift_id}
              onChange={(e) => setEditAssignForm((f) => ({ ...f, shift_id: e.target.value }))}
              data-testid="tt-edit-assign-shift"
            >
              <option value="">Select shift…</option>
              {activeShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name} ({s.start_time}–{s.end_time})
                </option>
              ))}
              {editingAssignment &&
                !activeShifts.some((s) => s.id === editingAssignment.shift_id) && (
                  <option value={editingAssignment.shift_id}>
                    {editingAssignment.shift_code} — {editingAssignment.shift_name} (inactive)
                  </option>
                )}
            </Select>
          </Field>
          <Field label="Effective from">
            <Input
              type="date"
              value={editAssignForm.effective_from}
              onChange={(e) => setEditAssignForm((f) => ({ ...f, effective_from: e.target.value }))}
              data-testid="tt-edit-assign-from"
            />
          </Field>
          <Field label="Effective to (optional)">
            <Input
              type="date"
              value={editAssignForm.effective_to}
              onChange={(e) => setEditAssignForm((f) => ({ ...f, effective_to: e.target.value }))}
              data-testid="tt-edit-assign-to"
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

export default TimeTrackingPage;
