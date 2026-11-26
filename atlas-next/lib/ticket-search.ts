/**
 * Ticket register search — patterns from Expensify shortcuts, Linear filters,
 * and Emburse Approval Inbox (multi-token AND, field ops, route shorthand).
 */

export type TicketSearchRow = {
  id: string;
  employee_id?: string;
  employee_code?: string | null;
  employee_name?: string | null;
  arabic_name?: string | null;
  department?: string | null;
  designation?: string | null;
  nationality?: string | null;
  origin_code?: string | null;
  destination_code?: string | null;
  ticket_number?: number | null;
  ticket_code?: string | null;
  excess_handling?: string | null;
  notes?: string | null;
  status?: string | null;
  ticket_cost?: string | number | null;
  entitlement?: string | number | null;
  excess_cost?: string | number | null;
  company_paid?: string | number | null;
  loan_code?: string | null;
  loan_id?: string | null;
  leave_start_date?: string | null;
  leave_end_date?: string | null;
  travel_date?: string | null;
};

export type PolicyLens = "all" | "over" | "in";

export type ParsedTicketQuery = {
  /** Free-text tokens that must ALL match the haystack (AND). */
  tokens: string[];
  /** origin→destination when user typed a route shorthand. */
  route?: { origin: string; destination: string };
  /** Explicit field filters (prefix:value). */
  fields: Partial<{
    name: string;
    code: string;
    route: string;
    dept: string;
    status: string;
    handling: string;
    ticket: string;
    policy: PolicyLens;
  }>;
};

const FIELD_RE = /^(name|code|route|dept|department|status|handling|ticket|id|policy):(.*)$/i;
const ROUTE_RE =
  /^([A-Za-z]{3})\s*(?:→|->|-|–|—|>|to)\s*([A-Za-z]{3})$/i;

export function ticketExcess(row: TicketSearchRow): number {
  const cost = Number(row.ticket_cost) || 0;
  const ent = Number(row.entitlement) || 0;
  if (row.excess_cost != null && row.excess_cost !== "") {
    const n = Number(row.excess_cost);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return Math.max(0, cost - ent);
}

export function ticketInPolicy(row: TicketSearchRow, eps = 0.005): boolean {
  return ticketExcess(row) <= eps;
}

/** Tokenize preserving "quoted phrases" and comma separators. */
function splitQueryParts(raw: string): string[] {
  const parts: string[] = [];
  const re = /"([^"]+)"|'([^']+)'|[^,\s]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    parts.push((m[1] ?? m[2] ?? m[0]).trim());
  }
  return parts.filter(Boolean);
}

/** Split query into field ops + free tokens; detect BOM→BLR style routes. */
export function parseTicketQuery(raw: string): ParsedTicketQuery {
  const fields: ParsedTicketQuery["fields"] = {};
  const tokens: string[] = [];
  let route: ParsedTicketQuery["route"];

  for (const part of splitQueryParts(raw.trim())) {
    const fieldMatch = FIELD_RE.exec(part);
    if (fieldMatch) {
      const key = fieldMatch[1].toLowerCase();
      const val = fieldMatch[2].trim().toLowerCase();
      if (!val) continue;
      if (key === "department") fields.dept = val;
      else if (key === "id") fields.ticket = val;
      else if (key === "policy") {
        if (val.startsWith("over") || val === "out" || val === "excess") fields.policy = "over";
        else if (val.startsWith("in") || val === "ok" || val === "within") fields.policy = "in";
      } else {
        (fields as Record<string, string>)[key] = val;
      }
      continue;
    }

    const routeMatch = ROUTE_RE.exec(part);
    if (routeMatch) {
      route = {
        origin: routeMatch[1].toUpperCase(),
        destination: routeMatch[2].toUpperCase(),
      };
      continue;
    }

    tokens.push(part.toLowerCase());
  }

  // Two consecutive 3-letter airport tokens → treat as route (BOM BLR).
  if (!route && tokens.length >= 2) {
    const a = tokens[0];
    const b = tokens[1];
    if (/^[a-z]{3}$/.test(a) && /^[a-z]{3}$/.test(b)) {
      route = { origin: a.toUpperCase(), destination: b.toUpperCase() };
      tokens.splice(0, 2);
    }
  }

  return { tokens, route, fields };
}

export type TicketQueryChip = {
  id: string;
  label: string;
  /** Raw fragment to remove from the search string. */
  fragment: string;
};

/** Active query as dismissible chips (Linear / Infor active-filter tags). */
export function ticketQueryChips(raw: string): TicketQueryChip[] {
  const q = parseTicketQuery(raw);
  const chips: TicketQueryChip[] = [];
  if (q.route) {
    const label = `${q.route.origin}→${q.route.destination}`;
    chips.push({ id: "route", label, fragment: label });
  }
  for (const [key, val] of Object.entries(q.fields)) {
    if (val == null || val === "") continue;
    const fragment = `${key}:${val}`;
    chips.push({
      id: `field:${key}`,
      label: key === "policy" ? `policy:${val}` : fragment,
      fragment,
    });
  }
  for (const token of q.tokens) {
    const needsQuote = /\s/.test(token);
    const fragment = needsQuote ? `"${token}"` : token;
    chips.push({ id: `token:${token}`, label: fragment, fragment });
  }
  return chips;
}

/** Rebuild search string without one chip fragment (best-effort). */
export function removeTicketQueryChip(raw: string, chip: TicketQueryChip): string {
  const parts = splitQueryParts(raw.trim());
  const next = parts.filter((part) => {
    const lower = part.toLowerCase();
    const frag = chip.fragment.toLowerCase();
    if (lower === frag) return false;
    if (chip.id === "route") {
      return !ROUTE_RE.test(part);
    }
    if (chip.id.startsWith("field:")) {
      const key = chip.id.slice(6);
      return !new RegExp(`^${key}:`, "i").test(part);
    }
    if (chip.id.startsWith("token:")) {
      const tok = chip.id.slice(6);
      return lower !== tok && lower !== `"${tok}"` && lower !== `'${tok}'`;
    }
    return true;
  });
  return next.join(" ").trim();
}

export function serializeTicketQuery(q: ParsedTicketQuery): string {
  const parts: string[] = [];
  if (q.route) parts.push(`${q.route.origin}→${q.route.destination}`);
  for (const [key, val] of Object.entries(q.fields)) {
    if (val) parts.push(`${key}:${val}`);
  }
  for (const token of q.tokens) {
    parts.push(/\s/.test(token) ? `"${token}"` : token);
  }
  return parts.join(" ");
}

function normalizeTicketRef(raw: string): string {
  return (
    raw
      .replace(/^#/, "")
      .replace(/^t-?/i, "")
      .replace(/^#/, "")
      .replace(/^0+/, "") || "0"
  );
}

function looksLikeTicketRef(token: string): boolean {
  return /^(?:#|t-?#?)?\d+$/i.test(token);
}

function haystackFor(row: TicketSearchRow): string[] {
  const origin = (row.origin_code || "").toUpperCase();
  const dest = (row.destination_code || "").toUpperCase();
  const handling = String(row.excess_handling || "");
  return [
    row.employee_name,
    row.employee_code,
    row.arabic_name,
    row.department,
    row.designation,
    row.nationality,
    origin,
    dest,
    row.ticket_number != null ? String(row.ticket_number) : null,
    row.ticket_code,
    handling,
    handling.replace(/_/g, " "),
    row.notes,
    row.status,
    row.loan_code,
    row.travel_date,
    row.leave_start_date,
    row.leave_end_date,
    origin && dest ? `${origin} ${dest}` : null,
    origin && dest ? `${origin}→${dest}` : null,
    origin && dest ? `${origin}->${dest}` : null,
    origin && dest ? `${origin}-${dest}` : null,
    ticketInPolicy(row) ? "in policy within entitlement" : "over entitlement excess out of policy",
  ]
    .filter((v) => v != null && String(v).trim() !== "")
    .map((v) => String(v).toLowerCase());
}

function fieldMatches(row: TicketSearchRow, fields: ParsedTicketQuery["fields"]): boolean {
  if (fields.name) {
    const blob = `${row.employee_name || ""} ${row.arabic_name || ""}`.toLowerCase();
    if (!blob.includes(fields.name)) return false;
  }
  if (fields.code) {
    const code = String(row.employee_code || "").toLowerCase();
    if (!code.includes(fields.code)) return false;
  }
  if (fields.dept) {
    const dept = `${row.department || ""} ${row.designation || ""}`.toLowerCase();
    if (!dept.includes(fields.dept)) return false;
  }
  if (fields.status) {
    const st = String(row.status || "").toLowerCase();
    if (!st.includes(fields.status) && !st.replace(/_/g, " ").includes(fields.status)) return false;
  }
  if (fields.handling) {
    const h = String(row.excess_handling || "").toLowerCase().replace(/_/g, " ");
    if (!h.includes(fields.handling.replace(/_/g, " "))) return false;
  }
  if (fields.ticket) {
    const want = normalizeTicketRef(fields.ticket);
    const num = normalizeTicketRef(String(row.ticket_number ?? ""));
    const code = String(row.ticket_code || "").toLowerCase();
    const id = String(row.id || "").toLowerCase();
    if (
      !(
        num === want ||
        code.includes(fields.ticket) ||
        code.includes(`t-${want.padStart(6, "0")}`) ||
        id.startsWith(fields.ticket) ||
        String(row.ticket_number ?? "") === fields.ticket
      )
    ) {
      return false;
    }
  }
  if (fields.route) {
    const routeBlob = `${row.origin_code || ""}${row.destination_code || ""}`.toLowerCase();
    const parts = fields.route.split(/→|->|-|–|—|>|to/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      if (
        (row.origin_code || "").toLowerCase() !== parts[0] ||
        (row.destination_code || "").toLowerCase() !== parts[1]
      ) {
        return false;
      }
    } else if (!routeBlob.includes(fields.route.replace(/[^a-z0-9]/gi, ""))) {
      return false;
    }
  }
  if (fields.policy === "over" && ticketInPolicy(row)) return false;
  if (fields.policy === "in" && !ticketInPolicy(row)) return false;
  return true;
}

/** True when the row matches the parsed query (AND across tokens + fields). */
export function matchTicketQuery(row: TicketSearchRow, query: ParsedTicketQuery): boolean {
  if (!fieldMatches(row, query.fields)) return false;

  if (query.route) {
    if (
      (row.origin_code || "").toUpperCase() !== query.route.origin ||
      (row.destination_code || "").toUpperCase() !== query.route.destination
    ) {
      return false;
    }
  }

  if (query.tokens.length === 0) return true;

  const hay = haystackFor(row);
  return query.tokens.every((token) => {
    // Bare ticket refs: T-000115 / #115 / 115
    if (looksLikeTicketRef(token)) {
      const want = normalizeTicketRef(token);
      const num = normalizeTicketRef(String(row.ticket_number ?? ""));
      const code = String(row.ticket_code || "").toLowerCase();
      if (num === want || code.includes(token.replace(/^#/, "")) || code.includes(want)) {
        return true;
      }
    }
    return hay.some((h) => h.includes(token));
  });
}

export function filterTicketsBySearch<T extends TicketSearchRow>(
  rows: T[],
  search: string,
  opts?: { status?: string; policy?: PolicyLens }
): T[] {
  const status = opts?.status && opts.status !== "all" ? opts.status : null;
  const policy = opts?.policy && opts.policy !== "all" ? opts.policy : null;
  const parsed = parseTicketQuery(search || "");
  if (policy) parsed.fields.policy = policy;

  return rows.filter((row) => {
    if (status && row.status !== status) return false;
    return matchTicketQuery(row, parsed);
  });
}
