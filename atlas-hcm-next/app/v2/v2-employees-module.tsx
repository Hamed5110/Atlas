"use client";

import {
  CheckCircle2,
  Download,
  Filter,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserRoundPen,
  Users,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { atlasFetch, atlasMutation, Employee } from "../../lib/atlas-api";
import { restoreSavedSession, SavedSession } from "./v2-session";
import styles from "./v2-shell.module.css";

type StatusScope = "active" | "inactive" | "all";
type NoticeTone = "success" | "error" | "info";

type EmployeeEditForm = {
  code: string;
  name: string;
  bankCode: string;
  jobBand: string;
  joinDate: string;
  cpr: string;
  passport: string;
  nationality: string;
  branch: string;
  department: string;
  company: string;
  section: string;
  location: string;
  designation: string;
  group: string;
  reportingTo: string;
  bahrainiNational: "Yes" | "No";
  payrollStatus: string;
  accountNumber: string;
  passportExpiryDate: string;
  email: string;
  whatsappNumber: string;
  basicSalary: string;
  hra: string;
  specialDutyAllowance: string;
  carAllowance: string;
  petrolAllowance: string;
  phoneAllowance: string;
  grossSalary: string;
  gosiDeduction: string;
  averageSalary: string;
  religion: string;
  serialNo: string;
  lastWorkingDate: string;
  paidDays: string;
  maximumPayout: string;
  totalWorkingDays: string;
};

type InlineNotice = {
  tone: NoticeTone;
  text: string;
};

type BulkDeleteResponse = {
  deletedCount: number;
  deleted: Array<{ employeeId: number; employeeCode?: string; fullName?: string }>;
  blocked: Array<{
    employeeId: number;
    employeeCode?: string;
    fullName?: string;
    loans?: number;
    allocations?: number;
    emergencyTickets?: number;
    openingBalances?: number;
  }>;
  notFound: number[];
};

const AIRFARE_DEFAULT_PAYOUT = 150;

function moneyFormat(amount: number) {
  return new Intl.NumberFormat("en-BH", {
    style: "currency",
    currency: "BHD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount || 0));
}

function toEmployeeLifecycleStatus(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "Active";
  if (normalized === "inactive") return "Inactive";
  if (normalized === "terminated") return "Terminated";
  if (normalized === "termination") return "Terminated";
  if (normalized === "probation") return "Probation";
  if (normalized === "resign") return "Resign";
  if (normalized === "resigned") return "Resigned";
  if (normalized === "separated") return "Separated";
  return "Active";
}

function isAirfareEligibleEmployeeStatus(value: string | null | undefined) {
  return toEmployeeLifecycleStatus(value) === "Active";
}

function toNumber(value: string | number | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableNumber(value: string | number | undefined) {
  if (value === "" || value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: string | undefined) {
  return value ? String(value).slice(0, 10) : "";
}

function buildEditForm(employee: Employee): EmployeeEditForm {
  return {
    code: employee.EmployeeCode || "",
    name: employee.FullName || "",
    bankCode: employee.BankCode || "",
    jobBand: employee.JobBand || "",
    joinDate: dateValue(employee.JoinDate),
    cpr: employee.CPR || "",
    passport: employee.Passport || "",
    nationality: employee.Nationality || "",
    branch: employee.Branch || "",
    department: employee.Department || "",
    company: employee.Company || "",
    section: employee.Section || "",
    location: employee.Location || "",
    designation: employee.Designation || "",
    group: employee.EmpGroup || "",
    reportingTo: employee.ReportingTo || "",
    bahrainiNational: String(employee.BHStatus || "").toUpperCase() === "BH" ? "Yes" : "No",
    payrollStatus: employee.Status || employee.PayrollStatus || "Active",
    accountNumber: employee.AccountNumber || "",
    passportExpiryDate: dateValue(employee.PassportExpiryDate),
    email: employee.Email || "",
    whatsappNumber: employee.WhatsAppNumber || "",
    basicSalary: String(employee.BasicSalary ?? ""),
    hra: String(employee.HRA ?? ""),
    specialDutyAllowance: String(employee.SpecialDutyAllowance ?? ""),
    carAllowance: String(employee.CarAllowance ?? ""),
    petrolAllowance: String(employee.PetrolAllowance ?? ""),
    phoneAllowance: String(employee.PhoneAllowance ?? ""),
    grossSalary: String(employee.GrossSalary ?? ""),
    gosiDeduction: String(employee.GOSIDeduction ?? ""),
    averageSalary: String(employee.AverageSalary ?? ""),
    religion: employee.Religion || "",
    serialNo: String(employee.SerialNo ?? ""),
    lastWorkingDate: dateValue(employee.LastWorkingDate),
    paidDays: String(employee.AirfarePaidDays ?? 0),
    maximumPayout: String(employee.MaximumPayout ?? AIRFARE_DEFAULT_PAYOUT),
    totalWorkingDays: String(employee.TotalWorkingDays ?? 360)
  };
}

function parseEmployeeDeleteBlock(message: string) {
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const payload = JSON.parse(message.slice(jsonStart));
      const details = payload.details || {};
      return {
        loans: Number(details.loans) || 0,
        allocations: Number(details.allocations) || 0,
        emergencyTickets: Number(details.emergencyTickets) || 0,
        openingBalances: Number(details.openingBalances) || 0
      };
    } catch {
      return { loans: 0, allocations: 0, emergencyTickets: 0, openingBalances: 0 };
    }
  }
  return { loans: 0, allocations: 0, emergencyTickets: 0, openingBalances: 0 };
}

function formatDeleteError(action: string, id: number, error: unknown) {
  return `${action}: ${error instanceof Error ? error.message : `Unable to delete record #${id}. Please try again.`}`;
}

function EmployeeEditField({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className={styles.employeeModalField}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function V2EmployeesModule() {
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState("");
  const [searchText, setSearchText] = useState("");
  const [statusScope, setStatusScope] = useState<StatusScope>("active");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState<EmployeeEditForm | null>(null);

  const loadEmployees = useCallback(async () => {
    const restored = restoreSavedSession();
    setSavedSession(restored);
    if (!restored) {
      setEmployees([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const data = await atlasFetch<Employee[]>("/employees?scope=all", restored.session.token, restored.session.sessionId);
      setEmployees(data);
      setLastCheckedAt(new Date().toLocaleString("en-BH"));
      setSelectedIds((current) => current.filter((id) => data.some((employee) => employee.EmployeeID === id)));
    } catch (loadError) {
      setEmployees([]);
      setError(loadError instanceof Error ? loadError.message : "Employees could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  const canManageEmployees = !["employee", "viewer"].includes(String(savedSession?.session.user.role || "").toLowerCase());

  const activeCount = useMemo(
    () => employees.filter((employee) => isAirfareEligibleEmployeeStatus(employee.Status)).length,
    [employees]
  );
  const inactiveCount = useMemo(() => employees.length - activeCount, [activeCount, employees.length]);

  const filteredEmployees = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return employees.filter((employee) => {
      const eligible = isAirfareEligibleEmployeeStatus(employee.Status);
      if (statusScope === "active" && !eligible) return false;
      if (statusScope === "inactive" && eligible) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        employee.EmployeeCode,
        employee.FullName,
        employee.Department,
        employee.Designation,
        employee.Branch,
        employee.Status
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [employees, searchText, statusScope]);

  const selectedVisibleCount = useMemo(
    () => filteredEmployees.filter((employee) => selectedIds.includes(employee.EmployeeID)).length,
    [filteredEmployees, selectedIds]
  );

  const allVisibleSelected =
    filteredEmployees.length > 0 && filteredEmployees.every((employee) => selectedIds.includes(employee.EmployeeID));

  const selectedEmployeeCount = selectedIds.length;

  function toggleRow(employeeId: number, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, employeeId])] : current.filter((id) => id !== employeeId)
    );
  }

  function toggleAllVisible(checked: boolean) {
    if (checked) {
      setSelectedIds((current) => [...new Set([...current, ...filteredEmployees.map((employee) => employee.EmployeeID)])]);
      return;
    }
    const visibleIds = new Set(filteredEmployees.map((employee) => employee.EmployeeID));
    setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)));
  }

  function openEditEmployee(employee: Employee) {
    setEditingEmployee(employee);
    setEditForm(buildEditForm(employee));
    setInlineNotice({
      tone: "info",
      text: `Editing ${employee.EmployeeCode}. Opening balances remain in the legacy Opening Balance workflow for now.`
    });
  }

  function closeEditEmployee() {
    setEditingEmployee(null);
    setEditForm(null);
  }

  async function handleSaveEmployeeEdit() {
    if (!savedSession || !editingEmployee || !editForm) return;
    if (!editForm.code.trim() || !editForm.name.trim()) {
      setInlineNotice({ tone: "error", text: "Employee code and name are required." });
      return;
    }

    setActionBusy(true);
    setInlineNotice(null);
    try {
      const maximumPayout = toNumber(editForm.maximumPayout, Number(editingEmployee.MaximumPayout ?? AIRFARE_DEFAULT_PAYOUT));
      const totalWorkingDays = toNumber(editForm.totalWorkingDays, Number(editingEmployee.TotalWorkingDays ?? 360));
      const paidDays = toNumber(editForm.paidDays, Number(editingEmployee.AirfarePaidDays ?? 0));
      const monthDays = totalWorkingDays / 12;
      const payload = {
        code: editForm.code.trim(),
        name: editForm.name.trim(),
        bankCode: editForm.bankCode,
        jobBand: editForm.jobBand,
        joinDate: editForm.joinDate || dateValue(editingEmployee.JoinDate),
        cpr: editForm.cpr,
        passport: editForm.passport,
        nationality: editForm.nationality,
        branch: editForm.branch,
        department: editForm.department,
        company: editForm.company,
        section: editForm.section,
        location: editForm.location,
        designation: editForm.designation,
        group: editForm.group,
        reportingTo: editForm.reportingTo,
        bhStatus: editForm.bahrainiNational === "Yes" ? "BH" : "NON-BH",
        payrollStatus: editForm.payrollStatus,
        status: toEmployeeLifecycleStatus(editForm.payrollStatus),
        accountNumber: editForm.accountNumber,
        passportExpiryDate: editForm.passportExpiryDate || null,
        email: editForm.email,
        whatsappNumber: editForm.whatsappNumber,
        basicSalary: toNullableNumber(editForm.basicSalary),
        hra: toNullableNumber(editForm.hra),
        specialDutyAllowance: toNullableNumber(editForm.specialDutyAllowance),
        carAllowance: toNullableNumber(editForm.carAllowance),
        petrolAllowance: toNullableNumber(editForm.petrolAllowance),
        phoneAllowance: toNullableNumber(editForm.phoneAllowance),
        grossSalary: toNullableNumber(editForm.grossSalary),
        gosiDeduction: toNullableNumber(editForm.gosiDeduction),
        averageSalary: toNullableNumber(editForm.averageSalary),
        religion: editForm.religion,
        serialNo: toNullableNumber(editForm.serialNo),
        lastWorkingDate: editForm.lastWorkingDate || null,
        airfarePaidDays: paidDays,
        currentAirfare2024: 0,
        maximumPayout,
        jan: monthDays,
        feb: monthDays,
        mar: monthDays,
        apr: monthDays,
        may: monthDays,
        jun: monthDays,
        jul: monthDays,
        aug: monthDays,
        sep: monthDays,
        oct: monthDays,
        nov: monthDays,
        dec: monthDays
      };

      await atlasMutation(
        `/employees/${editingEmployee.EmployeeID}`,
        savedSession.session.token,
        savedSession.session.sessionId,
        "PUT",
        payload
      );
      await loadEmployees();
      setInlineNotice({ tone: "success", text: `Employee ${editForm.code} updated successfully.` });
      closeEditEmployee();
    } catch (saveError) {
      setInlineNotice({
        tone: "error",
        text: saveError instanceof Error ? saveError.message : "Employee update failed."
      });
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteEmployee(employee: Employee) {
    if (!savedSession) return;
    const employeeCode = String(employee.EmployeeCode || employee.EmployeeID);
    const typed = window.prompt(
      [
        `Delete employee ${employee.FullName}?`,
        `Employee code: ${employeeCode}`,
        "Type the employee code to confirm deletion."
      ].join("\n")
    );
    if (typed !== employeeCode) {
      setInlineNotice({ tone: "info", text: "Employee delete cancelled. The employee code did not match." });
      return;
    }

    setActionBusy(true);
    setInlineNotice(null);
    try {
      await atlasMutation(
        `/employees/${employee.EmployeeID}`,
        savedSession.session.token,
        savedSession.session.sessionId,
        "DELETE"
      );
      await loadEmployees();
      setSelectedIds((current) => current.filter((id) => id !== employee.EmployeeID));
      if (editingEmployee?.EmployeeID === employee.EmployeeID) closeEditEmployee();
      setInlineNotice({
        tone: "success",
        text: `Employee ${employeeCode} - ${employee.FullName} deleted.`
      });
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "";
      if (message.includes("EMPLOYEE_DELETE_BLOCKED")) {
        const detail = parseEmployeeDeleteBlock(message);
        const linkedText = [
          `${detail.loans} loan(s)`,
          `${detail.allocations} airfare allocation(s)`,
          `${detail.emergencyTickets} emergency ticket(s)`,
          `${detail.openingBalances} opening balance row(s)`
        ].join(", ");
        const forceOk = window.confirm(
          [
            `Employee ${employeeCode} has linked records: ${linkedText}.`,
            "Full delete will remove the employee and those linked operational records.",
            "Audit log entries and historical system logs remain protected.",
            "Continue with full employee delete?"
          ].join("\n")
        );
        if (!forceOk) {
          setInlineNotice({
            tone: "info",
            text: `Employee ${employeeCode} was not deleted. Linked records are still protected.`
          });
          setActionBusy(false);
          return;
        }
        try {
          await atlasMutation(
            `/employees/${employee.EmployeeID}?force=true`,
            savedSession.session.token,
            savedSession.session.sessionId,
            "DELETE"
          );
          await loadEmployees();
          setSelectedIds((current) => current.filter((id) => id !== employee.EmployeeID));
          if (editingEmployee?.EmployeeID === employee.EmployeeID) closeEditEmployee();
          setInlineNotice({
            tone: "success",
            text: `Employee ${employeeCode} - ${employee.FullName} fully deleted with linked operational records.`
          });
        } catch (forceError) {
          setInlineNotice({
            tone: "error",
            text: formatDeleteError("Full employee delete failed", employee.EmployeeID, forceError)
          });
        }
      } else {
        setInlineNotice({
          tone: "error",
          text: formatDeleteError("Employee delete failed", employee.EmployeeID, deleteError)
        });
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function handleBulkDeleteSelected() {
    if (!savedSession) return;
    if (!selectedIds.length) {
      setInlineNotice({ tone: "info", text: "Select at least one employee row before using bulk delete." });
      return;
    }

    const ok = window.confirm(`Delete ${selectedIds.length} selected employee(s)?`);
    if (!ok) {
      setInlineNotice({ tone: "info", text: "Bulk delete cancelled." });
      return;
    }

    setActionBusy(true);
    setInlineNotice(null);
    try {
      const uniqueIds = [...new Set(selectedIds)].filter((id) => Number.isFinite(id) && id > 0);
      const response = await atlasMutation<BulkDeleteResponse>(
        "/employees/bulk-delete",
        savedSession.session.token,
        savedSession.session.sessionId,
        "POST",
        { employeeIds: uniqueIds }
      );

      const deletedSet = new Set(response.deleted.map((entry) => entry.employeeId));
      const notFoundSet = new Set(response.notFound || []);
      setSelectedIds((current) => current.filter((id) => !deletedSet.has(id) && !notFoundSet.has(id)));
      await loadEmployees();

      if (response.blocked?.length) {
        setInlineNotice({
          tone: "info",
          text: `Deleted ${response.deletedCount} employee(s). ${response.blocked.length} row(s) stayed protected because they still have linked records.`
        });
      } else {
        setInlineNotice({
          tone: "success",
          text: `Deleted ${response.deletedCount} selected employee(s).`
        });
      }
    } catch (bulkError) {
      setInlineNotice({
        tone: "error",
        text: bulkError instanceof Error ? bulkError.message : "Bulk delete failed."
      });
    } finally {
      setActionBusy(false);
    }
  }

  if (!savedSession) {
    return (
      <section className={styles.moduleStack}>
        <section className={styles.overviewHero}>
          <div className={styles.overviewHeroCopy}>
            <p>Employee master migration</p>
            <h1>Sign in on ATLAS to load employee data.</h1>
            <span>
              The V2 employee workspace reads the same employee master contract as the legacy screen. Save a normal ATLAS session, then reopen this route to verify the live dataset.
            </span>
          </div>
          <div className={styles.moduleStateCard}>
            <strong>Session required</strong>
            <span>ATLAS employee data is available as soon as a valid session is restored.</span>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className={styles.moduleStack}>
      <section className={styles.overviewHero}>
        <div className={styles.overviewHeroCopy}>
          <p>Employee master migration</p>
          <h1>Employee workspace, now on live data.</h1>
          <span>
            Search, filter, review, edit, and remove live employee master rows from the V2 shell. This slice keeps the same backend contracts while bringing the action layer out of the legacy screen.
          </span>
        </div>
        <div className={styles.moduleStateCard}>
          <strong>Live sync</strong>
          <span>{loading ? "Refreshing employee master..." : `${employees.length} employee records loaded.`}</span>
          <small>{lastCheckedAt ? `Last checked ${lastCheckedAt}` : "Waiting for first sync."}</small>
        </div>
      </section>

      <section className={styles.moduleToolbar}>
        <div className={styles.moduleToolbarMeta}>
          <span className={styles.heroPill}>Employee master</span>
          <span className={styles.toolbarMetaText}>Signed in as {savedSession.session.user.fullName || savedSession.session.user.username}</span>
        </div>
        <div className={styles.actionCluster}>
          <button type="button" className={styles.moduleGhostButton} disabled>
            <Upload size={16} />
            <span>Import Excel</span>
          </button>
          <button type="button" className={styles.moduleGhostButton} disabled>
            <Download size={16} />
            <span>Export Master</span>
          </button>
          <button type="button" className={styles.moduleGhostButton} disabled>
            <UserRoundPen size={16} />
            <span>Add employee</span>
          </button>
          <button
            type="button"
            className={styles.moduleActionButton}
            onClick={() => void loadEmployees()}
            aria-label="Refresh employee data"
            data-testid="employees-refresh"
            disabled={loading || actionBusy}
          >
            <RefreshCw size={16} />
            <span>{loading ? "Refreshing" : "Refresh data"}</span>
          </button>
        </div>
      </section>

      {error ? (
        <section className={styles.errorPanel} role="alert">
          <Trash2 size={18} />
          <div>
            <strong>Employee sync failed</strong>
            <span>{error}</span>
          </div>
        </section>
      ) : null}

      {inlineNotice ? (
        <section
          className={`${styles.inlineNotice} ${inlineNotice.tone === "error" ? styles.inlineNoticeError : inlineNotice.tone === "success" ? styles.inlineNoticeSuccess : styles.inlineNoticeInfo}`}
          role="status"
        >
          <div>
            <strong>
              {inlineNotice.tone === "error" ? "Action blocked" : inlineNotice.tone === "success" ? "Action completed" : "Heads up"}
            </strong>
            <span>{inlineNotice.text}</span>
          </div>
          <button type="button" className={styles.inlineNoticeClose} onClick={() => setInlineNotice(null)} aria-label="Dismiss notice">
            <X size={16} />
          </button>
        </section>
      ) : null}

      <section className={styles.overviewMetricGrid}>
        <article className={styles.overviewMetricCard} data-testid="employees-total">
          <small>Total records</small>
          <strong>{employees.length}</strong>
          <span>All employee master rows returned by the live SQL-backed API.</span>
          <Users size={18} />
        </article>
        <article className={styles.overviewMetricCard} data-testid="employees-active">
          <small>Active employees</small>
          <strong>{activeCount}</strong>
          <span>Airfare-eligible active lifecycle rows.</span>
          <CheckCircle2 size={18} />
        </article>
        <article className={styles.overviewMetricCard} data-testid="employees-inactive">
          <small>Inactive / separated</small>
          <strong>{inactiveCount}</strong>
          <span>Inactive, probation, separated, resigned, and similar lifecycle rows.</span>
          <Filter size={18} />
        </article>
        <article className={styles.overviewMetricCard} data-testid="employees-selected">
          <small>Selected rows</small>
          <strong>{selectedVisibleCount}</strong>
          <span>Selection state follows the filtered live view.</span>
          <UserRoundPen size={18} />
        </article>
      </section>

      <article className={styles.panel}>
        <div className={styles.panelTitle}>
          <Search size={18} />
          <span>Employee register</span>
        </div>
        <div className={styles.employeeToolbar}>
          <label className={styles.searchBox} aria-label="Search employee master">
            <Search size={18} />
            <input
              placeholder="Search by code, name, department, designation, branch, or status"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              data-testid="employees-search"
            />
          </label>
          <label className={styles.filterSelectWrap}>
            <span>Status scope</span>
            <select
              value={statusScope}
              onChange={(event) => setStatusScope(event.target.value as StatusScope)}
              data-testid="employees-status-filter"
            >
              <option value="active">Active employees</option>
              <option value="inactive">Inactive / separated / probation</option>
              <option value="all">All employees</option>
            </select>
          </label>
        </div>

        <div className={styles.employeeActionBar}>
          <div className={styles.employeeActionMeta}>
            <strong>{filteredEmployees.length}</strong>
            <span>live row(s) in the current filtered view</span>
          </div>
          <div className={styles.actionCluster}>
            <button
              type="button"
              className={styles.secondaryActionButton}
              onClick={() => setSelectedIds([])}
              disabled={!selectedEmployeeCount || actionBusy}
            >
              Clear selection
            </button>
            <button
              type="button"
              className={styles.dangerActionButton}
              onClick={() => void handleBulkDeleteSelected()}
              disabled={!selectedEmployeeCount || actionBusy || !canManageEmployees}
              data-testid="employees-bulk-delete"
            >
              {actionBusy ? <Loader2 size={16} className={styles.spinningIcon} /> : <Trash2 size={16} />}
              <span>{selectedEmployeeCount ? `Delete selected (${selectedEmployeeCount})` : "Delete selected"}</span>
            </button>
          </div>
        </div>

        <div className={styles.employeeTable} role="table" aria-label="Employee master table">
          <div className={styles.employeeTableHeader} role="row">
            <span>
              <input
                type="checkbox"
                aria-label="Select all visible employee rows"
                checked={allVisibleSelected}
                onChange={(event) => toggleAllVisible(event.target.checked)}
                disabled={!filteredEmployees.length}
                data-testid="employees-select-all"
              />
            </span>
            <span>Employee</span>
            <span>Department</span>
            <span>Branch</span>
            <span>Status</span>
            <span>Closing days</span>
            <span>Closing amount</span>
            <span>Action</span>
          </div>

          {filteredEmployees.length === 0 ? (
            <div className={styles.emptyTableState}>
              <strong>No employee rows match this filter.</strong>
              <small>Adjust the status scope or search text to widen the current live view.</small>
            </div>
          ) : (
            filteredEmployees.map((employee) => {
              const lifecycle = toEmployeeLifecycleStatus(employee.Status);
              const active = isAirfareEligibleEmployeeStatus(employee.Status);
              return (
                <div
                  key={employee.EmployeeID}
                  className={styles.employeeTableRow}
                  role="row"
                  data-testid="employee-row"
                >
                  <span>
                    <input
                      type="checkbox"
                      aria-label={`Select ${employee.FullName}`}
                      checked={selectedIds.includes(employee.EmployeeID)}
                      onChange={(event) => toggleRow(employee.EmployeeID, event.target.checked)}
                    />
                  </span>
                  <span>
                    <strong>{employee.FullName}</strong>
                    <small>{employee.EmployeeCode}</small>
                  </span>
                  <span>{employee.Department || "-"}</span>
                  <span>{employee.Branch || "-"}</span>
                  <span>
                    <span className={styles.signalBadge} data-status={active ? "pass" : "warning"}>
                      {lifecycle}
                    </span>
                  </span>
                  <span>{Number(employee.ClosingBalanceDays ?? employee.RemainingBalance ?? employee.OpeningDays ?? 0).toFixed(2)}</span>
                  <span>{moneyFormat(Number(employee.ClosingBalanceBHD ?? 0))}</span>
                  <span className={styles.employeeActionCell}>
                    <div className={styles.tableActionGroup}>
                      <button
                        type="button"
                        className={styles.secondaryActionButton}
                        onClick={() => openEditEmployee(employee)}
                        disabled={!canManageEmployees || actionBusy}
                        data-testid={`employee-edit-${employee.EmployeeID}`}
                      >
                        <Pencil size={15} />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        className={styles.dangerActionButton}
                        onClick={() => void handleDeleteEmployee(employee)}
                        disabled={!canManageEmployees || actionBusy}
                        data-testid={`employee-delete-${employee.EmployeeID}`}
                      >
                        <Trash2 size={15} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.standardNote}>
          <div>
            <strong>Employees action slice is active</strong>
            <span>Edit, single delete, and bulk delete now run from the V2 employee register while import, add, and export stay queued for the next slice.</span>
          </div>
        </div>
      </article>

      {editingEmployee && editForm ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={closeEditEmployee}>
          <div
            className={styles.employeeModalCard}
            role="dialog"
            aria-modal="true"
            aria-label="Edit employee master"
            onClick={(event) => event.stopPropagation()}
            data-testid="employee-edit-modal"
          >
            <div className={styles.employeeModalHeader}>
              <div>
                <strong>Edit employee master</strong>
                <span>{editingEmployee.EmployeeCode} - {editingEmployee.FullName}</span>
              </div>
              <button type="button" className={styles.inlineNoticeClose} onClick={closeEditEmployee} aria-label="Close edit employee modal">
                <X size={16} />
              </button>
            </div>

            <div className={styles.employeeModalGrid}>
              <EmployeeEditField label="Employee code">
                <input value={editForm.code} disabled onChange={() => undefined} />
              </EmployeeEditField>
              <EmployeeEditField label="Full name">
                <input value={editForm.name} onChange={(event) => setEditForm((current) => current ? { ...current, name: event.target.value } : current)} data-testid="employee-edit-name" />
              </EmployeeEditField>
              <EmployeeEditField label="Join date">
                <input type="date" value={editForm.joinDate} onChange={(event) => setEditForm((current) => current ? { ...current, joinDate: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="Employee status">
                <select value={editForm.payrollStatus} onChange={(event) => setEditForm((current) => current ? { ...current, payrollStatus: event.target.value } : current)}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Probation">Probation</option>
                  <option value="Resigned">Resigned</option>
                  <option value="Separated">Separated</option>
                  <option value="Terminated">Terminated</option>
                </select>
              </EmployeeEditField>
              <EmployeeEditField label="Company">
                <input value={editForm.company} onChange={(event) => setEditForm((current) => current ? { ...current, company: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="Department">
                <input value={editForm.department} onChange={(event) => setEditForm((current) => current ? { ...current, department: event.target.value } : current)} data-testid="employee-edit-department" />
              </EmployeeEditField>
              <EmployeeEditField label="Branch">
                <input value={editForm.branch} onChange={(event) => setEditForm((current) => current ? { ...current, branch: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="Designation">
                <input value={editForm.designation} onChange={(event) => setEditForm((current) => current ? { ...current, designation: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="Pay group">
                <input value={editForm.group} onChange={(event) => setEditForm((current) => current ? { ...current, group: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="Reporting to">
                <input value={editForm.reportingTo} onChange={(event) => setEditForm((current) => current ? { ...current, reportingTo: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="Nationality">
                <input value={editForm.nationality} onChange={(event) => setEditForm((current) => current ? { ...current, nationality: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="Bahraini national">
                <select value={editForm.bahrainiNational} onChange={(event) => setEditForm((current) => current ? { ...current, bahrainiNational: event.target.value as "Yes" | "No" } : current)}>
                  <option value="No">Non Bahraini</option>
                  <option value="Yes">Bahraini</option>
                </select>
              </EmployeeEditField>
              <EmployeeEditField label="Email">
                <input value={editForm.email} onChange={(event) => setEditForm((current) => current ? { ...current, email: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="WhatsApp number">
                <input value={editForm.whatsappNumber} onChange={(event) => setEditForm((current) => current ? { ...current, whatsappNumber: event.target.value } : current)} data-testid="employee-edit-whatsapp" />
              </EmployeeEditField>
              <EmployeeEditField label="Maximum payout">
                <input type="number" step="0.01" value={editForm.maximumPayout} onChange={(event) => setEditForm((current) => current ? { ...current, maximumPayout: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="Current year working days">
                <input type="number" step="0.01" value={editForm.totalWorkingDays} onChange={(event) => setEditForm((current) => current ? { ...current, totalWorkingDays: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="Paid days">
                <input type="number" step="0.001" value={editForm.paidDays} onChange={(event) => setEditForm((current) => current ? { ...current, paidDays: event.target.value } : current)} />
              </EmployeeEditField>
              <EmployeeEditField label="Account number">
                <input value={editForm.accountNumber} onChange={(event) => setEditForm((current) => current ? { ...current, accountNumber: event.target.value } : current)} />
              </EmployeeEditField>
            </div>

            <div className={styles.employeeModalNote}>
              Opening balance values remain governed by the dedicated Opening Balance workflow. This edit modal updates the employee master contract only.
            </div>

            <div className={styles.employeeModalActions}>
              <button type="button" className={styles.secondaryActionButton} onClick={closeEditEmployee} disabled={actionBusy}>
                Cancel
              </button>
              <button type="button" className={styles.moduleActionButton} onClick={() => void handleSaveEmployeeEdit()} disabled={actionBusy} data-testid="employee-edit-save">
                {actionBusy ? <Loader2 size={16} className={styles.spinningIcon} /> : <Pencil size={16} />}
                <span>{actionBusy ? "Saving..." : "Update employee"}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
