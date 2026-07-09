"use client";

import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ListPlus,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  WalletCards,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { atlasFetch, atlasMutation, Employee } from "../../lib/atlas-api";
import { restoreSavedSession, SavedSession } from "./v2-session";
import styles from "./v2-shell.module.css";

type OpeningBalanceRegisterRow = {
  BalanceID?: number;
  OpeningBalanceID?: number;
  EmployeeID: number;
  EmployeeCode: string;
  FullName: string;
  Department?: string;
  Branch?: string;
  BalanceYear: number;
  OpeningDays: number;
  OpeningBHD: number;
  MaximumPayout?: number;
  IsActive?: boolean;
};

type OpeningLoanBalanceRow = {
  OpeningLoanBalanceID: number;
  EmployeeID: number;
  EmployeeCode: string;
  FullName: string;
  Department?: string;
  Branch?: string;
  BalanceYear: number;
  OpeningLoanAmount: number;
  PendingLoanCount: number;
  MonthlyEMI: number;
  CarriedFromYear?: number;
  SourceYearEndID?: number;
};

type OpeningBalanceCalculation = {
  openingDays: number;
  maximumPayout: number;
  openingBhd: number;
  formulaSource: string;
};

type OpeningBalanceForm = {
  employeeId: string;
  year: string;
  openingDays: string;
  openingBhd: string;
  maximumPayout: string;
};

type InlineNotice = {
  tone: "success" | "error" | "info";
  text: string;
};

const AIRFARE_DEFAULT_PAYOUT = 150;
const AIRFARE_MAX_DAYS = 60;

function moneyFormat(amount: number) {
  return new Intl.NumberFormat("en-BH", {
    style: "currency",
    currency: "BHD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount || 0));
}

function toNumber(value: string | number | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeOpeningYear(value: string | number | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return new Date().getFullYear();
  return Math.max(2000, Math.min(2100, Math.round(parsed)));
}

function isAirfareEligibleEmployeeStatus(value: string | null | undefined) {
  return String(value || "Active").trim().toLowerCase() === "active";
}

function openingBalanceKey(row: Pick<OpeningBalanceRegisterRow, "EmployeeID" | "BalanceYear">) {
  return `${row.EmployeeID}-${normalizeOpeningYear(row.BalanceYear)}`;
}

function OpeningField({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className={styles.employeeModalField}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function V2OpeningBalanceModule() {
  const currentYear = new Date().getFullYear();
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<OpeningBalanceRegisterRow[]>([]);
  const [loanRows, setLoanRows] = useState<OpeningLoanBalanceRow[]>([]);
  const [activeYear, setActiveYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [notice, setNotice] = useState<InlineNotice | null>(null);
  const [form, setForm] = useState<OpeningBalanceForm>({
    employeeId: "",
    year: String(currentYear),
    openingDays: "",
    openingBhd: "",
    maximumPayout: String(AIRFARE_DEFAULT_PAYOUT)
  });

  const loadOpeningBalanceData = useCallback(async (sessionOverride?: SavedSession | null, yearOverride?: string | number) => {
    const restored = sessionOverride ?? restoreSavedSession();
    setSavedSession(restored);
    const year = normalizeOpeningYear(yearOverride ?? activeYear);
    if (!restored) {
      setEmployees([]);
      setRows([]);
      setLoanRows([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [employeeData, openingRows, openingLoanRows] = await Promise.all([
        atlasFetch<Employee[]>("/employees?scope=all", restored.session.token, restored.session.sessionId),
        atlasFetch<OpeningBalanceRegisterRow[]>(`/opening-balances?year=${year}`, restored.session.token, restored.session.sessionId),
        atlasFetch<OpeningLoanBalanceRow[]>(`/opening-loan-balances?year=${year}`, restored.session.token, restored.session.sessionId)
      ]);
      setEmployees(employeeData);
      setRows(openingRows);
      setLoanRows(openingLoanRows);
      setSelectedKeys((current) => new Set([...current].filter((key) => openingRows.some((row) => openingBalanceKey(row) === key))));
      setLastCheckedAt(new Date().toLocaleString("en-BH"));
    } catch (loadError) {
      setRows([]);
      setLoanRows([]);
      setError(loadError instanceof Error ? loadError.message : "Opening balance data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [activeYear]);

  useEffect(() => {
    void loadOpeningBalanceData();
  }, [loadOpeningBalanceData]);

  const canManage = !["employee", "viewer"].includes(String(savedSession?.session.user.role || "").toLowerCase());
  const activeYearNumber = normalizeOpeningYear(activeYear);
  const yearMode = activeYearNumber < currentYear ? "Historical year" : activeYearNumber > currentYear ? "Future setup" : "Current year";

  const totals = useMemo(() => ({
    totalDays: rows.reduce((sum, row) => sum + Number(row.OpeningDays || 0), 0),
    totalAmount: rows.reduce((sum, row) => sum + Number(row.OpeningBHD || 0), 0),
    totalLoanAmount: loanRows.reduce((sum, row) => sum + Number(row.OpeningLoanAmount || 0), 0)
  }), [rows, loanRows]);

  const selectedRows = useMemo(() => rows.filter((row) => selectedKeys.has(openingBalanceKey(row))), [rows, selectedKeys]);
  const allSelected = rows.length > 0 && rows.every((row) => selectedKeys.has(openingBalanceKey(row)));
  const openingFormIsUpdate = Boolean(editingRowKey && editingRowKey === `${form.employeeId}-${normalizeOpeningYear(form.year)}`);

  async function refreshOpeningFormAmount(next: { openingDays?: string; maximumPayout?: string }) {
    if (!savedSession) return;
    const openingDays = next.openingDays ?? form.openingDays;
    const maximumPayout = next.maximumPayout ?? form.maximumPayout;
    const merged = { ...form, ...next };
    if (String(openingDays).trim() === "") {
      setForm({ ...merged, openingBhd: "" });
      return;
    }
    setForm(merged);
    try {
      const params = new URLSearchParams({
        openingDays: String(Math.min(AIRFARE_MAX_DAYS, toNumber(openingDays))),
        maximumPayout: String(toNumber(maximumPayout, AIRFARE_DEFAULT_PAYOUT))
      });
      const calculated = await atlasFetch<OpeningBalanceCalculation>(`/opening-balances/calculate?${params.toString()}`, savedSession.session.token, savedSession.session.sessionId);
      setForm((current) => ({
        ...current,
        ...next,
        openingBhd: Number(calculated.openingBhd || 0).toFixed(2)
      }));
    } catch (calculationError) {
      setNotice({
        tone: "error",
        text: calculationError instanceof Error ? calculationError.message : "Opening amount calculation failed."
      });
    }
  }

  function resetForm(yearOverride?: string | number) {
    const year = normalizeOpeningYear(yearOverride ?? activeYear);
    setEditingRowKey(null);
    setEditModalOpen(false);
    setForm({
      employeeId: "",
      year: String(year),
      openingDays: "",
      openingBhd: "",
      maximumPayout: String(AIRFARE_DEFAULT_PAYOUT)
    });
  }

  function openEditRow(row: OpeningBalanceRegisterRow) {
    setEditingRowKey(openingBalanceKey(row));
    setForm({
      employeeId: String(row.EmployeeID),
      year: String(normalizeOpeningYear(row.BalanceYear)),
      openingDays: String(Number(row.OpeningDays || 0)),
      openingBhd: String(Number(row.OpeningBHD || 0).toFixed(2)),
      maximumPayout: String(Number(row.MaximumPayout || AIRFARE_DEFAULT_PAYOUT))
    });
    setEditModalOpen(true);
    setNotice({
      tone: "info",
      text: `Editing ${row.EmployeeCode} opening balance for ${row.BalanceYear}. MSSQL still controls the opening amount calculation.`
    });
  }

  function prepareNextYear(row: OpeningBalanceRegisterRow) {
    const nextYear = normalizeOpeningYear(row.BalanceYear) + 1;
    setEditingRowKey(null);
    setEditModalOpen(false);
    setActiveYear(String(nextYear));
    setForm({
      employeeId: String(row.EmployeeID),
      year: String(nextYear),
      openingDays: String(Number(row.OpeningDays || 0)),
      openingBhd: "",
      maximumPayout: String(Number(row.MaximumPayout || AIRFARE_DEFAULT_PAYOUT))
    });
    setNotice({
      tone: "info",
      text: `Prepared ${row.EmployeeCode} opening balance for ${nextYear}. Review values, then Save opening balance to update the next year.`
    });
  }

  async function handleSave() {
    if (!savedSession) return;
    if (!canManage) {
      setNotice({ tone: "error", text: "Only admin, manager, or HR can save opening balances." });
      return;
    }
    const employee = employees.find((item) => item.EmployeeID === Number(form.employeeId));
    if (!employee) {
      setNotice({ tone: "error", text: "Select employee first." });
      return;
    }
    if (String(form.openingDays).trim() === "") {
      setNotice({ tone: "error", text: "Enter opening days before saving. Opening amount is calculated by MSSQL." });
      return;
    }

    const year = normalizeOpeningYear(form.year);
    const maximumPayout = toNumber(form.maximumPayout, employee.MaximumPayout || AIRFARE_DEFAULT_PAYOUT);
    const openingDays = Math.min(AIRFARE_MAX_DAYS, toNumber(form.openingDays));

    setActionBusy(true);
    setNotice(null);
    try {
      await atlasMutation("/opening-balances", savedSession.session.token, savedSession.session.sessionId, "POST", {
        employeeId: employee.EmployeeID,
        year,
        openingDays,
        openingBhd: null,
        maximumPayout
      });
      setActiveYear(String(year));
      await loadOpeningBalanceData(savedSession, year);
      resetForm(year);
      setNotice({
        tone: "success",
        text: `Opening balance ${openingFormIsUpdate ? "updated" : "saved"} for ${year}.`
      });
    } catch (saveError) {
      setNotice({
        tone: "error",
        text: saveError instanceof Error ? saveError.message : "Opening balance save failed."
      });
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDelete(row: OpeningBalanceRegisterRow) {
    if (!savedSession) return;
    if (!canManage) {
      setNotice({ tone: "error", text: "Only admin, manager, or HR can delete opening balances." });
      return;
    }
    const year = normalizeOpeningYear(row.BalanceYear);
    const ok = window.confirm(`Delete opening balance for ${row.EmployeeCode} in ${year}?`);
    if (!ok) return;
    setActionBusy(true);
    setNotice(null);
    try {
      await atlasMutation(`/opening-balances/${row.EmployeeID}/${year}`, savedSession.session.token, savedSession.session.sessionId, "DELETE");
      if (editingRowKey === openingBalanceKey(row)) resetForm(year);
      await loadOpeningBalanceData(savedSession, year);
      setNotice({ tone: "success", text: `Deleted ${row.EmployeeCode} opening balance for ${year}.` });
    } catch (deleteError) {
      setNotice({ tone: "error", text: deleteError instanceof Error ? deleteError.message : "Opening balance delete failed." });
    } finally {
      setActionBusy(false);
    }
  }

  async function handleBulkDelete() {
    if (!savedSession) return;
    if (!canManage) {
      setNotice({ tone: "error", text: "Only admin, manager, or HR can delete opening balances." });
      return;
    }
    if (!selectedRows.length) {
      setNotice({ tone: "info", text: "Select opening balance rows before deleting." });
      return;
    }
    const year = activeYearNumber;
    const ok = window.confirm(`Delete ${selectedRows.length} selected opening balance row(s) for ${year}?`);
    if (!ok) return;
    setActionBusy(true);
    setNotice(null);
    try {
      const result = await atlasMutation<{ deleted: number; year: number }>(
        "/opening-balances/bulk-delete",
        savedSession.session.token,
        savedSession.session.sessionId,
        "POST",
        { year, employeeIds: selectedRows.map((row) => row.EmployeeID) }
      );
      setSelectedKeys(new Set());
      await loadOpeningBalanceData(savedSession, year);
      resetForm(year);
      setNotice({ tone: "success", text: `Deleted ${result.deleted} selected opening balance row(s) for ${result.year}.` });
    } catch (bulkDeleteError) {
      setNotice({ tone: "error", text: bulkDeleteError instanceof Error ? bulkDeleteError.message : "Selected opening balance delete failed." });
    } finally {
      setActionBusy(false);
    }
  }

  function toggleRow(row: OpeningBalanceRegisterRow, checked: boolean) {
    const key = openingBalanceKey(row);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleAllRows(checked: boolean) {
    setSelectedKeys(checked ? new Set(rows.map((row) => openingBalanceKey(row))) : new Set());
  }

  async function changeYear(next: number | string) {
    const year = normalizeOpeningYear(next);
    setActiveYear(String(year));
    resetForm(year);
    setSelectedKeys(new Set());
    if (savedSession) {
      await loadOpeningBalanceData(savedSession, year);
    }
  }

  return (
    <section className={styles.moduleStack}>
      <section className={styles.overviewHero}>
        <div className={styles.overviewHeroCopy}>
          <p>Opening balance migration</p>
          <h1>Carry-forward balances with live SQL calculation.</h1>
          <span>
            This `/v2` slice brings the opening balance register, opening loan balances, year switching, add or update flow, and delete actions into the new shell while preserving the same MSSQL-backed amount calculation.
          </span>
        </div>
        <div className={styles.moduleStateCard}>
          <strong>{activeYearNumber}</strong>
          <span>{loading ? "Refreshing opening balance register..." : `${rows.length} opening balance row(s) loaded.`}</span>
          <small>{lastCheckedAt ? `Last checked ${lastCheckedAt}` : "Waiting for first sync."}</small>
        </div>
      </section>

      <section className={styles.moduleToolbar}>
        <div className={styles.moduleToolbarMeta}>
          <span className={styles.heroPill}>Opening balances</span>
          <span className={styles.toolbarMetaText}>Fiscal year {activeYearNumber} / {yearMode}</span>
        </div>
        <div className={styles.actionCluster}>
          <div className={styles.yearStepper} data-testid="opening-year-stepper">
            <button type="button" className={styles.iconButton} onClick={() => void changeYear(activeYearNumber - 1)} disabled={loading || actionBusy || activeYearNumber <= 2000} aria-label="Previous opening year">
              <ChevronLeft size={16} />
            </button>
            <strong>{activeYearNumber}</strong>
            <button type="button" className={styles.iconButton} onClick={() => void changeYear(activeYearNumber + 1)} disabled={loading || actionBusy || activeYearNumber >= 2100} aria-label="Next opening year">
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            type="button"
            className={styles.moduleActionButton}
            onClick={() => void loadOpeningBalanceData(savedSession, activeYear)}
            disabled={loading || actionBusy}
            data-testid="opening-balance-refresh"
          >
            <RefreshCw size={16} />
            <span>{loading ? "Refreshing" : "Refresh data"}</span>
          </button>
        </div>
      </section>

      {error ? (
        <section className={styles.errorPanel} role="alert">
          <ListPlus size={18} />
          <div>
            <strong>Opening balance sync failed</strong>
            <span>{error}</span>
          </div>
        </section>
      ) : null}

      {notice ? (
        <section className={styles.noticeBanner} data-tone={notice.tone} role="status">
          <div>
            <strong>{notice.tone === "success" ? "Done" : notice.tone === "error" ? "Needs attention" : "Review"}</strong>
            <span>{notice.text}</span>
          </div>
          <button type="button" className={styles.iconButton} onClick={() => setNotice(null)} aria-label="Close opening balance notice">
            <X size={16} />
          </button>
        </section>
      ) : null}

      <section className={styles.overviewMetricGrid}>
        <article className={styles.overviewMetricCard}>
          <small>Register rows</small>
          <strong>{rows.length}</strong>
          <span>Opening balance entries loaded for the selected fiscal year.</span>
          <ListPlus size={18} />
        </article>
        <article className={styles.overviewMetricCard}>
          <small>Total days</small>
          <strong>{totals.totalDays.toFixed(2)}</strong>
          <span>Combined opening balance days from the selected year register.</span>
          <CalendarClock size={18} />
        </article>
        <article className={styles.overviewMetricCard}>
          <small>Total amount</small>
          <strong>{moneyFormat(totals.totalAmount)}</strong>
          <span>MSSQL-calculated opening balance amount total for the selected year.</span>
          <WalletCards size={18} />
        </article>
        <article className={styles.overviewMetricCard}>
          <small>Opening loan balance</small>
          <strong>{moneyFormat(totals.totalLoanAmount)}</strong>
          <span>{loanRows.length} opening loan balance row(s) carried for the same year.</span>
          <WalletCards size={18} />
        </article>
      </section>

      <section className={styles.moduleColumns}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}>
            <ListPlus size={18} />
            <span>Opening balance register</span>
          </div>

          <div className={styles.employeeToolbar}>
            <div className={styles.actionCluster}>
              <button type="button" className={styles.secondaryActionButton} disabled={!canManage || actionBusy || selectedRows.length === 0} onClick={() => void handleBulkDelete()}>
                <Trash2 size={14} />
                <span>Delete selected {selectedRows.length ? `(${selectedRows.length})` : ""}</span>
              </button>
            </div>
            <label className={styles.filterSelectWrap}>
              <span>Opening year</span>
              <select value={activeYear} onChange={(event) => void changeYear(event.target.value)} disabled={loading || actionBusy}>
                {Array.from({ length: 11 }, (_, index) => currentYear - 3 + index).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.employeeTable}>
            <div className={styles.employeeTableHeader}>
              <span><input type="checkbox" aria-label="Select all opening balance rows" checked={allSelected} disabled={!rows.length} onChange={(event) => toggleAllRows(event.target.checked)} /></span>
              <span>Employee</span>
              <span>Opening days</span>
              <span>Opening amount</span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {rows.length === 0 ? (
              <div className={styles.emptyTableState}>
                <strong>No opening balance rows for {activeYearNumber}</strong>
                <small>Switch year or create a carry-forward entry for the selected fiscal year.</small>
              </div>
            ) : (
              rows.map((row) => (
                <div className={styles.employeeTableRow} key={openingBalanceKey(row)}>
                  <span><input type="checkbox" aria-label={`Select ${row.EmployeeCode} opening balance`} checked={selectedKeys.has(openingBalanceKey(row))} onChange={(event) => toggleRow(row, event.target.checked)} /></span>
                  <span><strong>{row.FullName}</strong><small>{row.EmployeeCode} / {row.Department || "-"}</small></span>
                  <span>{Number(row.OpeningDays || 0).toFixed(2)}</span>
                  <span>{moneyFormat(Number(row.OpeningBHD || 0))}</span>
                  <span><span className={styles.signalBadge} data-status={row.IsActive === false ? "warning" : "pass"}>{row.IsActive === false ? "Inactive" : "Active"}</span></span>
                  <span className={styles.tableActionGroup}>
                    <button type="button" className={styles.secondaryActionButton} onClick={() => openEditRow(row)} disabled={!canManage}>
                      <Pencil size={14} />
                      <span>Edit</span>
                    </button>
                    <button type="button" className={styles.secondaryActionButton} onClick={() => prepareNextYear(row)} disabled={!canManage}>
                      <CalendarClock size={14} />
                      <span>Update next year</span>
                    </button>
                    <button type="button" className={styles.secondaryActionButtonDanger} onClick={() => void handleDelete(row)} disabled={!canManage || actionBusy}>
                      <Trash2 size={14} />
                      <span>Delete</span>
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelTitle}>
            {openingFormIsUpdate ? <Pencil size={18} /> : <Save size={18} />}
            <span>{openingFormIsUpdate ? "Update opening balance" : "Add opening balance"}</span>
          </div>

          <div className={styles.employeeModalGrid}>
            <OpeningField label="Employee">
              <select
                value={form.employeeId}
                disabled={openingFormIsUpdate || !canManage}
                onChange={(event) => {
                  const employee = employees.find((item) => item.EmployeeID === Number(event.target.value));
                  setForm((current) => ({
                    ...current,
                    employeeId: event.target.value,
                    openingDays: "",
                    openingBhd: "",
                    maximumPayout: String(employee?.MaximumPayout || AIRFARE_DEFAULT_PAYOUT)
                  }));
                }}
              >
                <option value="">Select employee</option>
                {employees.map((employee) => (
                  <option key={employee.EmployeeID} value={employee.EmployeeID}>
                    {employee.EmployeeCode} - {employee.FullName}{isAirfareEligibleEmployeeStatus(employee.Status) ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
            </OpeningField>

            <OpeningField label="Opening year">
              <input
                type="number"
                min="2000"
                max="2100"
                value={form.year}
                disabled={openingFormIsUpdate || !canManage}
                onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))}
              />
            </OpeningField>

            <OpeningField label="Opening days">
              <input
                type="number"
                step="0.01"
                value={form.openingDays}
                disabled={!canManage}
                onChange={(event) => void refreshOpeningFormAmount({ openingDays: event.target.value })}
              />
            </OpeningField>

            <OpeningField label="Opening amount BHD">
              <input type="number" step="0.01" value={form.openingBhd} readOnly />
            </OpeningField>

            <OpeningField label="Maximum payout">
              <input
                type="number"
                step="0.01"
                min="0"
                max="150"
                value={form.maximumPayout}
                disabled={!canManage}
                onChange={(event) => void refreshOpeningFormAmount({ maximumPayout: event.target.value })}
              />
            </OpeningField>
          </div>

          <div className={styles.calcResult}>
            <span><small>Formula source</small><strong>dbo.fn_ATLAS_AirfareAmount</strong></span>
            <span><small>SQL amount</small><strong>{moneyFormat(toNumber(form.openingBhd))}</strong></span>
            <span><small>Rate source</small><strong>MSSQL</strong></span>
          </div>

          <div className={styles.employeeModalActions}>
            <button type="button" className={styles.moduleActionButton} onClick={() => void handleSave()} disabled={!canManage || actionBusy}>
              <Save size={16} />
              <span>{openingFormIsUpdate ? "Update opening balance" : "Save opening balance"}</span>
            </button>
            {(openingFormIsUpdate || form.employeeId || form.openingDays) ? (
              <button type="button" className={styles.secondaryActionButton} onClick={() => resetForm(form.year)} disabled={actionBusy}>
                <X size={14} />
                <span>{openingFormIsUpdate ? "Cancel edit" : "Reset form"}</span>
              </button>
            ) : null}
          </div>

          <div className={styles.standardNote}>
            <div>
              <strong>Carry-forward rule</strong>
              <span>Opening balance is the approved carry-forward balance used by Airfare Allocation. The amount stays calculated by MSSQL, not by the frontend.</span>
            </div>
          </div>
        </article>
      </section>

      <article className={styles.panel}>
        <div className={styles.panelTitle}>
          <WalletCards size={18} />
          <span>Opening loan balance</span>
        </div>
        <div className={styles.employeeTable}>
          <div className={styles.employeeTableHeader}>
            <span>Employee</span>
            <span>Opening loan amount</span>
            <span>Pending loans</span>
            <span>Monthly EMI</span>
            <span>Carried from</span>
            <span>Source</span>
          </div>
          {loanRows.length === 0 ? (
            <div className={styles.emptyTableState}>
              <strong>No opening loan balance rows for {activeYearNumber}</strong>
              <small>Loan carry-forward values will appear here after year-end or opening-loan setup.</small>
            </div>
          ) : (
            loanRows.map((row) => (
              <div className={styles.employeeTableRow} key={row.OpeningLoanBalanceID}>
                <span><strong>{row.FullName}</strong><small>{row.EmployeeCode} / {row.Department || "-"}</small></span>
                <span>{moneyFormat(Number(row.OpeningLoanAmount || 0))}</span>
                <span>{row.PendingLoanCount}</span>
                <span>{moneyFormat(Number(row.MonthlyEMI || 0))}</span>
                <span>{row.CarriedFromYear || "-"}</span>
                <span>{row.SourceYearEndID ? `Year-end #${row.SourceYearEndID}` : "Opening ledger"}</span>
              </div>
            ))
          )}
        </div>
      </article>

      {editModalOpen && openingFormIsUpdate ? (
        <div className={styles.modalBackdrop}>
          <section className={styles.employeeModalCard} role="dialog" aria-modal="true" aria-labelledby="opening-balance-edit-title">
            <div className={styles.employeeModalHeader}>
              <div>
                <strong id="opening-balance-edit-title">Edit opening balance</strong>
                <span>MSSQL calculates the amount through `dbo.fn_ATLAS_AirfareAmount`.</span>
              </div>
              <button type="button" className={styles.iconButton} aria-label="Close edit opening balance" onClick={() => resetForm(form.year)}>
                <X size={16} />
              </button>
            </div>

            <div className={styles.employeeModalGrid}>
              <OpeningField label="Employee">
                <select value={form.employeeId} disabled>
                  <option value="">Select employee</option>
                  {employees.map((employee) => (
                    <option key={employee.EmployeeID} value={employee.EmployeeID}>
                      {employee.EmployeeCode} - {employee.FullName}
                    </option>
                  ))}
                </select>
              </OpeningField>

              <OpeningField label="Opening year">
                <input type="number" value={form.year} disabled />
              </OpeningField>

              <OpeningField label="Opening days">
                <input type="number" step="0.01" value={form.openingDays} onChange={(event) => void refreshOpeningFormAmount({ openingDays: event.target.value })} />
              </OpeningField>

              <OpeningField label="Maximum payout">
                <input type="number" step="0.01" min="0" max="150" value={form.maximumPayout} onChange={(event) => void refreshOpeningFormAmount({ maximumPayout: event.target.value })} />
              </OpeningField>

              <OpeningField label="Opening amount BHD">
                <input type="number" step="0.01" value={form.openingBhd} readOnly />
              </OpeningField>
            </div>

            <div className={styles.calcResult}>
              <span><small>Formula source</small><strong>dbo.fn_ATLAS_AirfareAmount</strong></span>
              <span><small>SQL amount</small><strong>{moneyFormat(toNumber(form.openingBhd))}</strong></span>
              <span><small>Rate source</small><strong>MSSQL</strong></span>
            </div>

            <div className={styles.employeeModalActions}>
              <button type="button" className={styles.moduleActionButton} onClick={() => void handleSave()} disabled={actionBusy}>
                <Save size={16} />
                <span>Update opening balance</span>
              </button>
              <button type="button" className={styles.secondaryActionButton} onClick={() => resetForm(form.year)} disabled={actionBusy}>
                <X size={14} />
                <span>Cancel edit</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
