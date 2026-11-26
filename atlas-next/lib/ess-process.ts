/** ESS leave + air ticket process: submitted → approved → allocated (ticket) → paid. */

export const ESS_STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "approved", label: "Approved" },
  { key: "allocated", label: "Ticket allocated" },
  { key: "paid", label: "Paid" },
] as const;

export type EssStatus = "submitted" | "approved" | "allocated" | "paid" | "rejected";

export function isTravelRequest(requestType: string | undefined | null): boolean {
  return requestType === "airfare" || requestType === "ticket";
}

/** Steps shown for a request; loans skip ticket allocation. */
export function essSteps(requestType: string | undefined | null) {
  return isTravelRequest(requestType) ? ESS_STEPS : ESS_STEPS.filter((s) => s.key !== "allocated");
}

/** Index of the last completed step, or -1 when rejected. */
export function essStepIndex(status: string, requestType?: string | null): number {
  if (status === "rejected") return -1;
  const idx = essSteps(requestType).findIndex((s) => s.key === status);
  return idx < 0 ? 0 : idx;
}

/**
 * Why a request can't be edited/deleted (null = allowed). Mirrors the API:
 * HR can always edit (notes only once decided or ticketed, see essNotesOnlyReason);
 * delete anything except a ticketed request, and paid ones only as System Admin.
 */
export function essLockReason(
  r: { status: string; ticket_id?: string | null; employee_id?: string },
  action: "edit" | "delete",
  actor: EssActor = { staff: true }
): string | null {
  if (!actor.staff && !actor.employeeId) return "Your role can view ESS requests but not change them.";
  if (!actor.staff && r.employee_id !== actor.employeeId) return "You can change only your own requests.";
  if (!actor.staff && r.status !== "submitted")
    return "After a decision only HR can change this request. Ask HR.";
  if (action === "edit") return null;
  if (r.status === "paid")
    return actor.admin ? null : "Paid requests are closed. Only a System Admin can delete one, with a reason.";
  if (r.ticket_id || r.status === "allocated")
    return "A ticket is already issued. Delete the ticket in Airfare Allocation first; that sends this request back to Approved.";
  return null;
}

/** Once decided or ticketed, HR can still fix the notes; travel details stay as approved / ticketed. */
export function essNotesOnlyReason(r: { status: string; ticket_id?: string | null }): string | null {
  if (r.status === "paid")
    return "This request is paid and closed. Travel details come from the ticket, so only the notes can be changed.";
  if (r.ticket_id || r.status === "allocated")
    return "A ticket is already issued. Change travel details on the ticket in Airfare Allocation; only the notes can be changed here.";
  if (r.status === "rejected")
    return "This request was rejected. Only the notes can be changed; create a new request for new dates.";
  return null;
}

/** Who is acting: HR staff change any request; others only their own pending ones. */
export interface EssActor {
  staff: boolean;
  /** System Admin: may also delete paid requests (with a reason). */
  admin?: boolean;
  employeeId?: string | null;
}

/** Same roles as the API (custom roles carry their base role). */
export function essActor(me: { roles: string[]; employee_id?: string | null } | null): EssActor {
  const roles = new Set((me?.roles ?? []).map((r) => r.toLowerCase()));
  const admin = roles.has("admin") || roles.has("system_admin");
  const staff = admin || ["hr", "manager", "hr_manager"].some((r) => roles.has(r));
  return { staff, admin, employeeId: me?.employee_id ?? null };
}

const HISTORY_LINE =
  /^(?:Approved|Rejected|Paid|Deleted|Edited|Edited after approval|Notes edited) by .+? on \d{2}-\d{2}-\d{4}\b/;

/** Typed notes vs the system history lines, which the API keeps and the form must not edit. */
export function splitEssNotes(notes: string | null | undefined): { text: string; history: string[] } {
  const text: string[] = [];
  const history: string[] = [];
  for (const line of (notes ?? "").split(/\r?\n/)) (HISTORY_LINE.test(line) ? history : text).push(line);
  return { text: text.join("\n").trim(), history };
}

type EssDetail = Pick<
  EssFormValues,
  | "request_type"
  | "trip_type"
  | "leave_start_date"
  | "leave_end_date"
  | "travel_date"
  | "return_date"
  | "origin_code"
  | "destination_code"
>;

/** Detail changes need re-approval once approved; a notes-only edit does not. */
export function essDetailsChanged(before: EssDetail, after: EssDetail): boolean {
  const norm = (v: EssDetail) => [
    v.request_type,
    v.trip_type,
    v.leave_start_date || "",
    v.leave_end_date || "",
    v.travel_date || "",
    v.trip_type === "ROUND_TRIP" ? v.return_date || "" : "",
    (v.origin_code || "").toUpperCase(),
    (v.destination_code || "").toUpperCase(),
  ];
  return norm(before).join("|") !== norm(after).join("|");
}

/** Deleting an approved or paid request needs a reason (it was promised or paid out). */
export function essDeleteNeedsReason(status: string): boolean {
  return status === "approved" || status === "paid";
}

export interface EssWhatsAppResult {
  sent?: boolean;
  queued?: boolean;
  skipped?: string;
  error?: string;
  audience?: "approver" | "employee";
  recipients?: string[];
}

/** Plain-words outcome of an ESS WhatsApp notice for a toast. */
export function describeEssWhatsApp(
  wa: EssWhatsAppResult | null | undefined
): { tone: "success" | "warning" | "info"; text: string } | null {
  if (!wa) return null;
  const who = wa.audience === "approver" ? "the approver" : "the employee";
  if (wa.sent) return { tone: "success", text: `WhatsApp sent to ${who}.` };
  if (wa.queued) return { tone: "warning", text: `WhatsApp to ${who} is queued: the WhatsApp session is not connected (Settings → WhatsApp).` };
  if (wa.skipped === "no_number")
    return {
      tone: "warning",
      text:
        wa.audience === "approver"
          ? "No WhatsApp sent: no reporting-officer or HR WhatsApp number is on file."
          : "No WhatsApp sent: the employee has no WhatsApp number on file.",
    };
  if (wa.skipped === "evolution_disabled") return { tone: "info", text: "WhatsApp is switched off for this system." };
  if (wa.error) return { tone: "warning", text: `WhatsApp to ${who} failed: ${wa.error}` };
  return null;
}

function parseIsoDate(value: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** ISO date `n` calendar days after `iso` (n may be negative); "" when `iso` is not a date. */
export function addDaysIso(iso: string, n: number): string {
  const t = parseIsoDate(iso);
  if (t === null) return "";
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

export interface EssFormValues {
  employee_id: string;
  request_type: string;
  trip_type: "ROUND_TRIP" | "ONE_WAY";
  leave_start_date: string;
  leave_end_date: string;
  travel_date: string;
  return_date: string;
  origin_code: string;
  destination_code: string;
}

export type EssFieldKey = keyof EssFormValues;

export interface EssCheck {
  level: "error" | "warning";
  field?: EssFieldKey;
  text: string;
}

export interface EssCheckContext {
  today: string;
  /** Other live (not rejected) requests of the same employee. */
  otherRequests?: { leave_start_date?: string | null; leave_end_date?: string | null; status: string }[];
  employeeHasWhatsApp?: boolean;
  shortNoticeDays?: number;
}

/**
 * Pre-submit checks. Errors block submit (the server enforces the same rules);
 * warnings are advice HR should see before sending the request for approval.
 */
export function essFormChecks(form: EssFormValues, ctx: EssCheckContext): EssCheck[] {
  const out: EssCheck[] = [];
  const travel = isTravelRequest(form.request_type);
  if (!form.employee_id) out.push({ level: "error", field: "employee_id", text: "Choose the employee." });
  if (Boolean(form.leave_start_date) !== Boolean(form.leave_end_date)) {
    out.push({
      level: "error",
      field: form.leave_start_date ? "leave_end_date" : "leave_start_date",
      text: "Enter both Leave from and Leave to, or leave both blank.",
    });
  } else if (form.leave_start_date && form.leave_end_date < form.leave_start_date) {
    out.push({ level: "error", field: "leave_end_date", text: "Leave to cannot be before Leave from." });
  }
  if (!form.travel_date) out.push({ level: "error", field: "travel_date", text: "Enter the departure date." });
  if (form.trip_type === "ROUND_TRIP" && form.return_date && form.travel_date && form.return_date < form.travel_date)
    out.push({ level: "error", field: "return_date", text: "Return date cannot be before the departure date." });
  if (form.origin_code.length !== 3)
    out.push({ level: "error", field: "origin_code", text: "Choose the origin airport." });
  if (form.destination_code.length !== 3)
    out.push({ level: "error", field: "destination_code", text: "Choose the destination airport." });
  if (
    form.origin_code.length === 3 &&
    form.origin_code.toUpperCase() === form.destination_code.toUpperCase()
  )
    out.push({ level: "error", field: "destination_code", text: "Origin and destination must differ." });

  const from = form.leave_start_date;
  const to = form.leave_end_date;
  if (from && to && to >= from) {
    const clash = (ctx.otherRequests ?? []).find(
      (r) =>
        r.status !== "rejected" &&
        r.leave_start_date &&
        r.leave_end_date &&
        String(r.leave_start_date).slice(0, 10) <= to &&
        String(r.leave_end_date).slice(0, 10) >= from
    );
    if (clash)
      out.push({
        level: "error",
        field: "leave_start_date",
        text: `Overlaps another ${clash.status} request (${String(clash.leave_start_date).slice(0, 10)} to ${String(clash.leave_end_date).slice(0, 10)}).`,
      });
    if (travel && form.travel_date && (form.travel_date < addDaysIso(from, -3) || form.travel_date > to))
      out.push({
        level: "warning",
        field: "travel_date",
        text: "Departure is outside the leave window (more than 3 days before it, or after it ends).",
      });
    if (travel && form.trip_type === "ROUND_TRIP" && form.return_date && form.return_date > to)
      out.push({
        level: "warning",
        field: "return_date",
        text: "Return flight lands after the leave ends: extend the leave or bring the return forward.",
      });
  }
  const notice = ctx.shortNoticeDays ?? 7;
  if (form.travel_date && form.travel_date >= ctx.today && form.travel_date < addDaysIso(ctx.today, notice))
    out.push({
      level: "warning",
      field: "travel_date",
      text: `Short notice: departure is less than ${notice} days away, so fares may be higher.`,
    });
  if (form.travel_date && form.travel_date < ctx.today)
    out.push({ level: "warning", field: "travel_date", text: "Departure date is in the past (back-dated request)." });
  if (form.employee_id && ctx.employeeHasWhatsApp === false)
    out.push({
      level: "warning",
      text: "This employee has no WhatsApp number on file, so they will not get status messages.",
    });
  return out;
}

/** Leave days with both ends counted (1–30 Jul = 30 days); null when incomplete or reversed. */
export function inclusiveLeaveDays(
  from: string | null | undefined,
  to: string | null | undefined
): number | null {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (a === null || b === null || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}
