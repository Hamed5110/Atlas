"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, FileSpreadsheet, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { ImportPanel } from "@/components/import-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, SearchInput, StatCard } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, download, errorMessage } from "@/lib/api";
import { canManage, useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtMonth, money, statusTone, titleCase, todayLocal } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { ExcelToolbar } from "@/components/excel-toolbar";
import type {
  CommissionMeta,
  CommissionVoucher,
  CommissionVoucherCreateResult,
  Employee,
} from "@/lib/types";

type ConfirmKind =
  | "save"
  | "save-print"
  | "duplicate"
  | "edit"
  | "edit-duplicate"
  | "delete"
  | "import-duplicate"
  | null;

interface LineDraft {
  employee_id: string;
  amount: string;
  remarks: string;
  commission_type?: string;
}

const EMPTY_LINE: LineDraft = { employee_id: "", amount: "", remarks: "" };

const EMPTY_HEADER = {
  voucher_date: todayLocal(),
  period_month: todayLocal().slice(0, 7),
  status: "approved",
  currency: "BHD",
  note: "",
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Soft cap: a single commission line above this triggers a review hint (not a block). */
const HIGH_LINE_AMOUNT = 10000;
/** Commissions are booked in Bahraini Dinar only. */
const LOCKED_CURRENCY = "BHD";
/** Visible deployment marker — lets support confirm which bundle a browser actually runs. */
const BUILD_STAMP = "2026-09-21.pin-footer";

function CommissionsPage() {
  const t = useT();
  const { me } = useAuth();
  const writable = canManage(me);
  const queryClient = useQueryClient();

  // ---- voucher entry form (screenshot layout) ----
  const [header, setHeader] = useState({ ...EMPTY_HEADER });
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);
  // Stays true until the user edits the fresh form; allows one-time month preload.
  const pristineRef = useRef(true);
  const preloadedMonthRef = useRef(false);

  // ---- voucher register filters ----
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFrom, setMonthFrom] = useState("");
  const [monthTo, setMonthTo] = useState("");
  const [voucherNoFilter, setVoucherNoFilter] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");

  // ---- dialogs / confirm flow ----
  const [editing, setEditing] = useState<CommissionVoucher | null>(null);
  const [editHeader, setEditHeader] = useState({ ...EMPTY_HEADER, paid_on: "" });
  const [editLines, setEditLines] = useState<LineDraft[]>([]);
  const [deleting, setDeleting] = useState<CommissionVoucher | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [duplicateMessage, setDuplicateMessage] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const importRetryRef = useRef<(() => void) | null>(null);

  const querySuffix = useMemo(() => {
    const params = new URLSearchParams({ limit: "500" });
    if (statusFilter) params.set("status", statusFilter);
    if (monthFrom) params.set("month_from", monthFrom);
    if (monthTo) params.set("month_to", monthTo);
    if (voucherNoFilter.trim()) params.set("voucher_no", voucherNoFilter.trim());
    if (amountMin && Number(amountMin) >= 0) params.set("amount_min", amountMin);
    if (amountMax && Number(amountMax) >= 0) params.set("amount_max", amountMax);
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [statusFilter, monthFrom, monthTo, voucherNoFilter, amountMin, amountMax, search]);

  const vouchers = useQuery({
    queryKey: ["commission-vouchers", querySuffix],
    queryFn: () => api<CommissionVoucher[]>(`/commissions/vouchers?${querySuffix}`),
  });
  const hasFilters = Boolean(
    search.trim() || statusFilter || monthFrom || monthTo || voucherNoFilter.trim() || amountMin || amountMax
  );
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setMonthFrom("");
    setMonthTo("");
    setVoucherNoFilter("");
    setAmountMin("");
    setAmountMax("");
  };
  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });
  const meta = useQuery({
    queryKey: ["commissions-meta"],
    queryFn: () => api<CommissionMeta>("/commissions/meta"),
  });

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>();
    for (const e of employees.data ?? []) map.set(e.id, e);
    return map;
  }, [employees.data]);

  // Preload the period month from the latest voucher once, only while the form is untouched.
  useEffect(() => {
    if (preloadedMonthRef.current || !pristineRef.current) return;
    const latest = vouchers.data?.[0]; // register is sorted newest voucher first
    if (latest?.period_month && MONTH_RE.test(latest.period_month)) {
      preloadedMonthRef.current = true;
      setHeader((h) => ({ ...h, period_month: latest.period_month }));
    }
  }, [vouchers.data]);

  const stats = useMemo(() => {
    const all = vouchers.data ?? [];
    return {
      count: all.length,
      total: all.reduce((sum, v) => sum + Number(v.total), 0),
      approved: all.filter((v) => v.status === "approved").length,
      paid: all.filter((v) => v.status === "paid").length,
    };
  }, [vouchers.data]);

  const formTotal = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
    [lines]
  );
  const editTotal = useMemo(
    () => editLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
    [editLines]
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["commission-vouchers"] });
    queryClient.invalidateQueries({ queryKey: ["commissions"] });
    queryClient.invalidateQueries({ queryKey: ["commissions-meta"] });
  };

  const clearForm = () => {
    // Keep the last-used period month: clerks enter vouchers month by month.
    setHeader((h) => ({ ...EMPTY_HEADER, period_month: h.period_month || EMPTY_HEADER.period_month }));
    setLines([{ ...EMPTY_LINE }]);
  };

  const patchHeader = (patch: Partial<typeof EMPTY_HEADER>) => {
    pristineRef.current = false;
    setHeader((h) => ({ ...h, ...patch }));
  };

  const setLine = (index: number, patch: Partial<LineDraft>) => {
    pristineRef.current = false;
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };
  const setEditLine = (index: number, patch: Partial<LineDraft>) => {
    setEditLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const validLines = (rows: LineDraft[]) =>
    rows.filter((l) => l.employee_id || l.amount || l.remarks);

  const validateForm = (rows: LineDraft[], month: string): string | null => {
    if (!MONTH_RE.test(month)) return "Enter a valid period month (YYYY-MM).";
    const filled = validLines(rows);
    if (filled.length === 0) return "Add at least one employee line.";
    const picked = new Set<string>();
    for (const l of filled) {
      if (!l.employee_id) return "Every row needs an employee.";
      if (picked.has(l.employee_id)) {
        return "The same employee appears twice in this voucher — merge the amounts into one line.";
      }
      picked.add(l.employee_id);
      if (!(Number(l.amount) > 0)) return "Every row needs a commission amount greater than zero.";
    }
    return null;
  };

  const createPayload = (allowDuplicate: boolean) => ({
    voucher_date: header.voucher_date || null,
    period_month: header.period_month,
    status: header.status,
    currency: header.currency || "BHD",
    note: header.note,
    lines: validLines(lines).map((l) => ({
      employee_id: l.employee_id,
      amount: Number(l.amount),
      remarks: l.remarks,
    })),
    allow_duplicate: allowDuplicate,
  });

  const printVoucher = (voucherId: string, voucherNo: string) => {
    void download(`/commissions/vouchers/${voucherId}/print.pdf`, `commission-${voucherNo}.pdf`).catch(
      (err) => toast.error("Print failed", errorMessage(err))
    );
  };

  const createMutation = useMutation({
    mutationFn: (opts: { allowDuplicate: boolean; print: boolean }) =>
      api<CommissionVoucherCreateResult>("/commissions/vouchers", {
        method: "POST",
        body: createPayload(opts.allowDuplicate),
      }).then((data) => ({ data, print: opts.print })),
    onSuccess: ({ data, print }) => {
      if (data.created === false && data.duplicate_warning) {
        setDuplicateMessage(data.message || "Some employees already have commission lines for this month.");
        setConfirmKind("duplicate");
        return;
      }
      toast.success(
        "Voucher saved",
        `${data.voucher_no} · ${data.line_count} ${t("comm.lines")} · ${money(data.total, data.currency || "BHD")}`
      );
      setConfirmKind(null);
      if (print) printVoucher(data.id, data.voucher_no);
      clearForm();
      setEntryOpen(false);
      invalidate();
    },
    onError: (err) => {
      setConfirmKind(null);
      toast.error("Save failed", errorMessage(err));
    },
  });

  const editPayload = (allowDuplicate: boolean) => ({
    voucher_date: editHeader.voucher_date || null,
    period_month: editHeader.period_month,
    status: editHeader.status,
    currency: editHeader.currency || "BHD",
    note: editHeader.note,
    paid_on: editHeader.status === "paid" ? editHeader.paid_on || null : null,
    lines: validLines(editLines).map((l) => ({
      employee_id: l.employee_id,
      amount: Number(l.amount),
      remarks: l.remarks,
      ...(l.commission_type ? { commission_type: l.commission_type } : {}),
    })),
    allow_duplicate: allowDuplicate,
  });

  const editMutation = useMutation({
    mutationFn: (allowDuplicate: boolean) =>
      api<CommissionVoucherCreateResult>(`/commissions/vouchers/${editing!.id}`, {
        method: "PATCH",
        headers: { "If-Match": String(editing!.version) },
        body: editPayload(allowDuplicate),
      }),
    onSuccess: (data) => {
      if (data.duplicate_warning) {
        setDuplicateMessage(data.message || "Some employees already have commission lines for this month.");
        setConfirmKind("edit-duplicate");
        return;
      }
      toast.success("Voucher updated", data.voucher_no);
      setConfirmKind(null);
      setEditing(null);
      invalidate();
    },
    onError: (err) => {
      setConfirmKind(null);
      toast.error("Edit failed", errorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (voucher: CommissionVoucher) =>
      api(`/commissions/vouchers/${voucher.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(voucher.version) },
      }),
    onSuccess: () => {
      toast.success("Voucher deleted");
      setConfirmKind(null);
      setDeleting(null);
      invalidate();
    },
    onError: (err) => {
      setConfirmKind(null);
      toast.error("Delete failed", errorMessage(err));
    },
  });

  const confirmBusy = createMutation.isPending || editMutation.isPending || deleteMutation.isPending;

  const requestSave = (print: boolean) => {
    const problem = validateForm(lines, header.period_month);
    if (problem) {
      toast.warning("Missing details", problem);
      return;
    }
    setConfirmKind(print ? "save-print" : "save");
  };

  const openEdit = (voucher: CommissionVoucher) => {
    setEditing(voucher);
    setEditHeader({
      voucher_date: voucher.voucher_date ? String(voucher.voucher_date).slice(0, 10) : todayLocal(),
      period_month: voucher.period_month,
      status: voucher.status || "approved",
      currency: voucher.currency || "BHD",
      note: voucher.note || "",
      paid_on: voucher.paid_on ? String(voucher.paid_on).slice(0, 10) : "",
    });
    setEditLines(
      (voucher.lines ?? []).map((l) => ({
        employee_id: l.employee_id,
        amount: String(l.amount),
        remarks: l.remarks || "",
        commission_type: l.commission_type || undefined,
      }))
    );
  };

  const requestEdit = () => {
    if (!editing) return;
    const problem = validateForm(editLines, editHeader.period_month);
    if (problem) {
      toast.warning("Missing details", problem);
      return;
    }
    setConfirmKind("edit");
  };

  const confirmCopy = (): { title: string; message: string; label: string; destructive?: boolean } => {
    switch (confirmKind) {
      case "save":
      case "save-print": {
        const high = validLines(lines).some((l) => Number(l.amount) > HIGH_LINE_AMOUNT);
        return {
          title: "Save voucher?",
          message: `Save a ${fmtMonth(header.period_month)} voucher with ${validLines(lines).length} employee(s), total ${money(
            formTotal,
            header.currency || "BHD"
          )} (${titleCase(header.status)})?${high ? " An amount exceeds the high-value threshold — please double-check." : ""}${confirmKind === "save-print" ? " The PDF prints right after." : ""}`,
          label: confirmKind === "save-print" ? t("comm.savePrint") : t("comm.save"),
        };
      }
      case "duplicate":
        return {
          title: t("comm.duplicateTitle"),
          message: `${duplicateMessage} Save the voucher anyway?`,
          label: "Save anyway",
        };
      case "edit":
        return {
          title: "Save voucher changes?",
          message: `Save changes to ${editing?.voucher_no ?? "voucher"} → ${validLines(editLines).length} employee(s), total ${money(
            editTotal,
            editHeader.currency || "BHD"
          )} (${titleCase(editHeader.status)})?`,
          label: "Save changes",
        };
      case "edit-duplicate":
        return {
          title: t("comm.duplicateTitle"),
          message: `${duplicateMessage} Save the changes anyway?`,
          label: "Save anyway",
        };
      case "import-duplicate":
        return {
          title: t("comm.duplicateTitle"),
          message: `${duplicateMessage} Import anyway?`,
          label: "Import anyway",
        };
      case "delete":
        return {
          title: t("comm.deleteVoucher") + "?",
          message: `Delete voucher ${deleting?.voucher_no ?? ""} (${deleting?.line_count ?? 0} lines, ${money(
            deleting?.total ?? 0,
            deleting?.currency || "BHD"
          )})? It is soft-deleted and kept in the audit trail.`,
          label: "Delete",
          destructive: true,
        };
      default:
        return { title: "", message: "", label: "Confirm" };
    }
  };

  const runConfirmedAction = () => {
    switch (confirmKind) {
      case "save":
        createMutation.mutate({ allowDuplicate: false, print: false });
        break;
      case "save-print":
        createMutation.mutate({ allowDuplicate: false, print: true });
        break;
      case "duplicate":
        createMutation.mutate({ allowDuplicate: true, print: false });
        break;
      case "edit":
        editMutation.mutate(false);
        break;
      case "edit-duplicate":
        editMutation.mutate(true);
        break;
      case "delete":
        if (deleting) deleteMutation.mutate(deleting);
        break;
      case "import-duplicate":
        setConfirmKind(null);
        importRetryRef.current?.();
        break;
      default:
        break;
    }
  };

  const renderGrid = (
    rows: LineDraft[],
    update: (index: number, patch: Partial<LineDraft>) => void,
    remove: (index: number) => void,
    add: () => void,
    total: number,
    currency: string,
    idPrefix: string,
    readOnly: boolean
  ) => {
    // Employees picked in more than one row (can only happen on legacy edit prefill;
    // fresh picks are blocked below). Used to tint the offending rows.
    const seenIds = new Set<string>();
    const duplicateIds = new Set<string>();
    for (const l of rows) {
      if (!l.employee_id) continue;
      if (seenIds.has(l.employee_id)) duplicateIds.add(l.employee_id);
      seenIds.add(l.employee_id);
    }
    return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
      <div className="table-sheet-scroll relative min-h-0 flex-1 overflow-auto">
      <Table className="table-fixed" wrap={false}>
        <THead>
          <TR>
            <TH className="w-12">#</TH>
            <TH className="w-[24%]">{t("comm.code")}</TH>
            <TH className="w-[18%]">{t("comm.name")}</TH>
            <TH className="w-[16%]">{t("comm.designation")}</TH>
            <TH className="w-[16%]">{t("comm.department")}</TH>
            <TH className="w-40">{t("comm.amount")}</TH>
            <TH>{t("comm.remarks")}</TH>
            {!readOnly ? <TH className="w-12 text-right"> </TH> : null}
          </TR>
        </THead>
        <TBody>
          {rows.map((line, index) => {
            const emp = line.employee_id ? employeeById.get(line.employee_id) : undefined;
            const isDuplicate = Boolean(line.employee_id) && duplicateIds.has(line.employee_id);
            return (
              <TR
                key={index}
                data-testid={`${idPrefix}-line-${index}`}
                className={isDuplicate ? "bg-[var(--color-destructive)]/10" : undefined}
              >
                <TD className="text-xs text-[var(--color-muted-foreground)]">{index + 1}</TD>
                <TD>
                  {readOnly ? (
                    <span className="font-mono font-semibold">{emp?.code ?? line.employee_id}</span>
                  ) : (
                    <EmployeeCombobox
                      className="w-full"
                      employees={employees.data ?? []}
                      value={line.employee_id}
                      labelMode="code"
                      placeholder="Code or name…"
                      excludeIds={rows
                        .filter((_, i) => i !== index)
                        .map((l) => l.employee_id)
                        .filter(Boolean)}
                      data-testid={`${idPrefix}-employee-${index}`}
                      onChange={(id) => {
                        if (id && rows.some((l, i) => i !== index && l.employee_id === id)) {
                          const dup = employeeById.get(id);
                          toast.warning(
                            "Duplicate employee",
                            `${dup ? `${dup.code} — ${dup.full_name}` : "This employee"} is already on this voucher — edit the existing row instead.`
                          );
                          return;
                        }
                        update(index, { employee_id: id });
                      }}
                    />
                  )}
                  {isDuplicate ? (
                    <p className="mt-0.5 text-[11px] font-semibold text-[var(--color-destructive)]">
                      Already on this voucher
                    </p>
                  ) : null}
                </TD>
                <TD className="font-semibold">{emp?.full_name ?? "—"}</TD>
                <TD>{emp?.designation ?? "—"}</TD>
                <TD>{emp?.department ?? "—"}</TD>
                <TD>
                  {readOnly ? (
                    <span className="font-bold">{money(line.amount, currency)}</span>
                  ) : (
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.amount}
                      data-testid={`${idPrefix}-amount-${index}`}
                      onChange={(e) => update(index, { amount: e.target.value })}
                      onKeyDown={(e) => {
                        // Keyboard-first entry: Enter on the last row's amount appends
                        // the next row and moves focus to its employee picker.
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        if (index !== rows.length - 1) return;
                        add();
                        requestAnimationFrame(() => {
                          document
                            .querySelector<HTMLInputElement>(
                              `[data-testid="${idPrefix}-employee-${index + 1}"]`
                            )
                            ?.focus();
                        });
                      }}
                    />
                  )}
                </TD>
                <TD>
                  {readOnly ? (
                    line.remarks || "—"
                  ) : (
                    <Input
                      value={line.remarks}
                      maxLength={500}
                      placeholder="—"
                      data-testid={`${idPrefix}-remarks-${index}`}
                      onChange={(e) => update(index, { remarks: e.target.value })}
                    />
                  )}
                </TD>
                {!readOnly ? (
                  <TD className="text-end">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("comm.removeLine")}
                      title={t("comm.removeLine")}
                      data-testid={`${idPrefix}-remove-${index}`}
                      disabled={rows.length <= 1}
                      onClick={() => remove(index)}
                    >
                      <X size={14} className="text-[var(--color-destructive)]" aria-hidden />
                    </Button>
                  </TD>
                ) : null}
              </TR>
            );
          })}
        </TBody>
      </Table>
      </div>
      <div
        className="flex shrink-0 items-center justify-end gap-6 border-t border-[var(--color-border)] bg-[var(--color-muted)] px-4 py-2.5 font-bold"
        data-testid={`${idPrefix}-total-row`}
      >
        <span className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {t("comm.total")}
        </span>
        <span className="font-mono text-base" data-testid={`${idPrefix}-total`}>
          {money(total, currency)}
        </span>
      </div>
    </div>
    );
  };

  const copy = confirmCopy();

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="commissions-page">
      <PageHeader
        title={t("page.commissions.title")}
        subtitle={t("page.commissions.subtitle")}
        actions={
          <>
            <ExcelToolbar dataset="commission-vouchers" />
            {writable ? (
              <Button
                variant="gradient"
                data-testid="btn-new-voucher"
                onClick={() => {
                  clearForm();
                  setEntryOpen(true);
                }}
              >
                <Plus size={15} /> New
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Vouchers" value={stats.count} icon={<BadgeDollarSign size={20} />} tone="primary" />
        <StatCard label="Total amount" value={money(stats.total)} icon={<BadgeDollarSign size={20} />} tone="accent" />
        <StatCard label="Approved" value={stats.approved} icon={<Badge variant="info">●</Badge>} tone="warning" />
        <StatCard label="Paid" value={stats.paid} icon={<Badge variant="success">✓</Badge>} tone="success" />
      </div>

      {/* Focus Lyte sales invoice: list on the home page, New opens a voucher window. */}
      {writable ? (
        <Dialog
          open={entryOpen}
          onClose={() => setEntryOpen(false)}
          size="full"
          scroll="content"
          title={t("comm.newVoucher")}
          description="Type a code or name in the Code cell. Name, designation and department fill from the employee master."
          footer={
            <div
              className="flex w-full flex-wrap items-center justify-between gap-2"
              data-testid="commission-voucher-footer"
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  data-testid="btn-add-line"
                  onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
                >
                  <Plus size={15} /> {t("comm.addLine")}
                </Button>
                <Button
                  variant="outline"
                  data-testid="btn-import-excel"
                  onClick={() => setImportOpen(true)}
                >
                  <FileSpreadsheet size={15} /> Import Excel
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="gradient" data-testid="btn-save-voucher" disabled={confirmBusy} onClick={() => requestSave(false)}>
                  {t("comm.save")}
                </Button>
                <Button
                  variant="outline"
                  data-testid="btn-save-print-voucher"
                  disabled={confirmBusy}
                  onClick={() => requestSave(true)}
                >
                  <Printer size={15} /> {t("comm.savePrint")}
                </Button>
                <Button variant="ghost" data-testid="btn-clear-voucher" disabled={confirmBusy} onClick={clearForm}>
                  {t("comm.clear")}
                </Button>
              </div>
            </div>
          }
        >
        <div data-testid="commission-voucher-card" className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="grid shrink-0 items-end gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label={t("bi.voucherNo")} htmlFor="commission-voucher-no">
                <Input
                  id="commission-voucher-no"
                  data-testid="commission-voucher-no"
                  value="CM-••••••"
                  readOnly
                  disabled
                  title="Assigned automatically on save"
                />
              </Field>
              <Field label={t("comm.voucherDate")} htmlFor="commission-voucher-date">
                <Input
                  id="commission-voucher-date"
                  data-testid="commission-voucher-date"
                  type="date"
                  value={header.voucher_date}
                  onChange={(e) => patchHeader({ voucher_date: e.target.value })}
                />
              </Field>
              <Field label={t("comm.periodMonth")} htmlFor="commission-voucher-month">
                <Input
                  id="commission-voucher-month"
                  data-testid="commission-voucher-month"
                  type="month"
                  value={header.period_month}
                  onChange={(e) => patchHeader({ period_month: e.target.value })}
                />
              </Field>
              <Field label="Status" htmlFor="commission-voucher-status">
                <Select
                  id="commission-voucher-status"
                  data-testid="commission-voucher-status"
                  value={header.status}
                  onChange={(e) => patchHeader({ status: e.target.value })}
                >
                  {(meta.data?.statuses ?? ["draft", "approved", "paid"]).map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("bi.currency")} htmlFor="commission-voucher-currency">
                <Input
                  id="commission-voucher-currency"
                  data-testid="commission-voucher-currency"
                  value={LOCKED_CURRENCY}
                  readOnly
                  disabled
                  title="Currency locked to BHD"
                />
              </Field>
              <Field label="Note" htmlFor="commission-voucher-note">
                <Input
                  id="commission-voucher-note"
                  data-testid="commission-voucher-note"
                  value={header.note}
                  maxLength={500}
                  placeholder="Optional note"
                  onChange={(e) => patchHeader({ note: e.target.value })}
                />
              </Field>
            </div>

            <div data-testid="commission-line-grid" className="flex min-h-0 min-w-0 flex-1 flex-col">
              {renderGrid(
                lines,
                setLine,
                (index) => setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index))),
                () => setLines((prev) => [...prev, { ...EMPTY_LINE }]),
                formTotal,
                header.currency || "BHD",
                "commission-line",
                false
              )}
            </div>
            {validLines(lines).some((l) => Number(l.amount) > HIGH_LINE_AMOUNT) ? (
              <p
                className="shrink-0 text-xs font-semibold text-[var(--color-warning)]"
                data-testid="commission-high-amount-hint"
              >
                High-value check: an amount exceeds {money(HIGH_LINE_AMOUNT, LOCKED_CURRENCY)} — please
                double-check the amount before saving.
              </p>
            ) : null}
        </div>
        </Dialog>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>{t("comm.voucherList")}</CardTitle>
              <CardDescription>{vouchers.data?.length ?? 0} vouchers</CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t("bi.voucherNo")}>
                <Input
                  value={voucherNoFilter}
                  onChange={(e) => setVoucherNoFilter(e.target.value)}
                  className="h-10 w-32"
                  placeholder="CM-000001"
                  data-testid="voucher-filter-no"
                />
              </Field>
              <Field label="Status">
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-10 w-32"
                  data-testid="voucher-filter-status"
                >
                  <option value="">All</option>
                  {(meta.data?.statuses ?? ["draft", "approved", "paid"]).map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From month">
                <Input
                  type="month"
                  value={monthFrom}
                  onChange={(e) => setMonthFrom(e.target.value)}
                  className="h-10 w-36"
                  data-testid="voucher-filter-month-from"
                />
              </Field>
              <Field label="To month">
                <Input
                  type="month"
                  value={monthTo}
                  onChange={(e) => setMonthTo(e.target.value)}
                  className="h-10 w-36"
                  data-testid="voucher-filter-month-to"
                />
              </Field>
              <Field label={t("bi.amountMin")}>
                <Input
                  type="number"
                  min="0"
                  value={amountMin}
                  onChange={(e) => setAmountMin(e.target.value)}
                  className="h-10 w-28"
                  data-testid="voucher-filter-amount-min"
                />
              </Field>
              <Field label={t("bi.amountMax")}>
                <Input
                  type="number"
                  min="0"
                  value={amountMax}
                  onChange={(e) => setAmountMax(e.target.value)}
                  className="h-10 w-28"
                  data-testid="voucher-filter-amount-max"
                />
              </Field>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search vouchers…"
                className="w-48"
                data-testid="voucher-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {vouchers.isPending ? (
            <TableSkeleton columns={9} label={t("state.loading")} />
          ) : vouchers.isError ? (
            <ErrorState error={vouchers.error} onRetry={vouchers.refetch} />
          ) : (vouchers.data ?? []).length === 0 ? (
            hasFilters ? (
              <EmptyState
                icon={<BadgeDollarSign size={22} />}
                title={t("empty.noResults.title")}
                message={t("empty.noResults.message")}
                action={
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    {t("action.clearFilters")}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<BadgeDollarSign size={22} />}
                title={t("empty.vouchers.title")}
                message={t("empty.vouchers.message")}
              />
            )
          ) : (
            <Table cards className="table-auto table-header-clip min-w-[66rem]" aria-label="Commission vouchers">
              <THead>
                <TR>
                  <TH className="min-w-[8.5rem] tracking-normal">{t("bi.voucherNo")}</TH>
                  <TH className="min-w-[9rem] tracking-normal">{t("comm.voucherDate")}</TH>
                  <TH className="min-w-[8.5rem] tracking-normal">{t("comm.periodMonth")}</TH>
                  <TH className="min-w-[5.5rem] tracking-normal">{t("comm.lines")}</TH>
                  <TH className="min-w-[7rem] tracking-normal desk-num">{t("comm.total")}</TH>
                  <TH className="min-w-[6rem] tracking-normal">Status</TH>
                  <TH className="min-w-[6rem] tracking-normal">Note</TH>
                  <TH className="min-w-[9rem] tracking-normal">Created</TH>
                  <TH className="min-w-[6.5rem] tracking-normal text-end">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(vouchers.data ?? []).map((v) => (
                  <TR key={v.id} data-testid={`voucher-row-${v.voucher_no}`}>
                    <TD className="font-mono font-bold">{v.voucher_no}</TD>
                    <TD className="whitespace-nowrap">{v.voucher_date ? fmtDate(v.voucher_date) : "—"}</TD>
                    <TD className="whitespace-nowrap font-semibold">{fmtMonth(v.period_month)}</TD>
                    <TD>
                      <Badge variant="info">{v.line_count}</Badge>
                    </TD>
                    <TD className="desk-num font-bold">{money(v.total, v.currency || "BHD")}</TD>
                    <TD>
                      <Badge variant={statusTone(v.status) as never}>{titleCase(v.status)}</Badge>
                      {v.status === "paid" && v.paid_on ? (
                        <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">on {fmtDate(v.paid_on)}</p>
                      ) : null}
                    </TD>
                    <TD className="max-w-[14rem] truncate" title={v.note || undefined}>
                      {v.note || "—"}
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-[var(--color-muted-foreground)]">
                      {fmtDateTime(v.created_at)}
                    </TD>
                    <TD className="text-end">
                      <div className="inline-flex flex-nowrap justify-end gap-1.5" role="group" aria-label={`Actions for ${v.voucher_no}`}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("comm.printVoucher")}
                          title={t("comm.printVoucher")}
                          data-testid={`btn-print-voucher-${v.id}`}
                          onClick={() => printVoucher(v.id, v.voucher_no)}
                        >
                          <Printer size={14} aria-hidden />
                        </Button>
                        {writable ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("comm.editVoucher")}
                              title={t("comm.editVoucher")}
                              data-testid={`btn-edit-voucher-${v.id}`}
                              onClick={() => openEdit(v)}
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("comm.deleteVoucher")}
                              title={t("comm.deleteVoucher")}
                              data-testid={`btn-delete-voucher-${v.id}`}
                              onClick={() => {
                                setDeleting(v);
                                setConfirmKind("delete");
                              }}
                            >
                              <Trash2 size={14} className="text-[var(--color-destructive)]" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p
        className="mt-6 text-right text-[11px] text-[var(--color-muted-foreground)]"
        data-testid="commissions-build-stamp"
      >
        ATLAS build {BUILD_STAMP}
      </p>

      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import commission vouchers from Excel"
        description="Download the template, fill one row per employee, then verify and import. Rows sharing a group + month become one voucher."
        size="full"
      >
        <ImportPanel
          title="Commission Excel import"
          description="Required: employee_code, amount. Optional: remarks, period_month (YYYY-MM), voucher_date, voucher_group."
          templateName="commissions"
          previewPath={`/commissions/import/preview?default_month=${encodeURIComponent(header.period_month)}`}
          commitPath="/commissions/import/commit"
          columns={[
            { key: "employee_code", label: t("comm.code") },
            { key: "employee_name", label: t("comm.name") },
            { key: "amount", label: t("comm.amount") },
            { key: "period_month", label: t("comm.periodMonth") },
            { key: "voucher_group", label: "Group" },
            { key: "remarks", label: t("comm.remarks") },
          ]}
          commitExtra={{ period_month: header.period_month, status: "approved" }}
          onDuplicateWarning={(retry, message) => {
            importRetryRef.current = retry;
            setDuplicateMessage(message);
            setConfirmKind("import-duplicate");
          }}
          onCommitted={() => {
            setImportOpen(false);
            invalidate();
          }}
        />
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `${t("comm.editVoucher")} — ${editing.voucher_no}` : t("comm.editVoucher")}
        description={
          editing
            ? `${fmtMonth(editing.period_month)} · ${money(editing.total, editing.currency || "BHD")} · ${titleCase(editing.status)}`
            : undefined
        }
        size="full"
        scroll="content"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              data-testid="btn-edit-add-line"
              onClick={() => setEditLines((prev) => [...prev, { ...EMPTY_LINE }])}
            >
              <Plus size={15} /> {t("comm.addLine")}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button variant="gradient" data-testid="btn-save-edit-voucher" onClick={requestEdit}>
                Review & save
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid shrink-0 grid-cols-2 gap-4 md:grid-cols-5">
            <Field label={t("comm.voucherDate")}>
              <Input
                type="date"
                value={editHeader.voucher_date}
                data-testid="edit-voucher-date"
                onChange={(e) => setEditHeader((h) => ({ ...h, voucher_date: e.target.value }))}
              />
            </Field>
            <Field label={t("comm.periodMonth")}>
              <Input
                type="month"
                value={editHeader.period_month}
                data-testid="edit-voucher-month"
                onChange={(e) => setEditHeader((h) => ({ ...h, period_month: e.target.value }))}
              />
            </Field>
            <Field label="Status">
              <Select
                value={editHeader.status}
                data-testid="edit-voucher-status"
                onChange={(e) => setEditHeader((h) => ({ ...h, status: e.target.value }))}
              >
                {(meta.data?.statuses ?? ["draft", "approved", "paid"]).map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("bi.currency")}>
              <Input
                value={LOCKED_CURRENCY}
                readOnly
                disabled
                data-testid="edit-voucher-currency"
                title="Currency locked to BHD"
              />
            </Field>
            {editHeader.status === "paid" ? (
              <Field label="Paid on">
                <Input
                  type="date"
                  value={editHeader.paid_on}
                  data-testid="edit-voucher-paid-on"
                  onChange={(e) => setEditHeader((h) => ({ ...h, paid_on: e.target.value }))}
                />
              </Field>
            ) : null}
            <Field label="Note" className="col-span-2 md:col-span-5">
              <Input
                value={editHeader.note}
                maxLength={500}
                data-testid="edit-voucher-note"
                onChange={(e) => setEditHeader((h) => ({ ...h, note: e.target.value }))}
              />
            </Field>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {renderGrid(
            editLines,
            setEditLine,
            (index) => setEditLines((prev) => prev.filter((_, i) => i !== index)),
            () => setEditLines((prev) => [...prev, { ...EMPTY_LINE }]),
            editTotal,
            editHeader.currency || "BHD",
            "edit-line",
            false
          )}
          </div>

          {editing?.status === "paid" ? (
            <p className="shrink-0 text-xs text-[var(--color-muted-foreground)]">{t("comm.paidGuard")}</p>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmKind)}
        onClose={() => setConfirmKind(null)}
        onConfirm={runConfirmedAction}
        title={copy.title}
        message={copy.message}
        confirmLabel={confirmBusy ? t("state.working") : copy.label}
        destructive={copy.destructive}
        busy={confirmBusy}
      />
    </div>
  );
}

export default CommissionsPage;
