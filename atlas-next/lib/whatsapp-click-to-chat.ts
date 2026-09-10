/**
 * Manual WhatsApp click-to-chat helpers (NOT Evolution API).
 * Hardened for True Mode: digit normalization + E.164 length gate.
 */

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;
const MAX_RECIPIENTS = 5;

/** Strip to digits only. Returns empty string if outside E.164 length bounds. */
export function normalizeWhatsAppNumber(value: string): string {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return "";
  return digits;
}

/**
 * Parse one-or-many WhatsApp numbers from free text / list.
 * Accepts comma, semicolon, newline, pipe, or slash separators. Dedupes; max 5.
 */
export function parseWhatsAppNumbers(value: string | string[] | null | undefined): string[] {
  const chunks: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) chunks.push(...String(item || "").split(/[,;\n\r\t|/]+/));
  } else {
    chunks.push(...String(value || "").split(/[,;\n\r\t|/]+/));
  }
  const found: string[] = [];
  const seen = new Set<string>();
  for (const raw of chunks) {
    const digits = normalizeWhatsAppNumber(raw);
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    found.push(digits);
    if (found.length >= MAX_RECIPIENTS) break;
  }
  return found;
}

/** Build https://wa.me/<digits>?text=<encoded> or "" if invalid. */
export function buildWhatsAppUrl(number: string, message: string): string {
  const cleanNumber = normalizeWhatsAppNumber(number);
  if (!cleanNumber) return "";
  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(String(message || ""))}`;
}

/** Display as +E.164 digits or "-" when invalid. */
export function formatWhatsAppDisplayNumber(value: string): string {
  const cleanNumber = normalizeWhatsAppNumber(value);
  return cleanNumber ? `+${cleanNumber}` : "-";
}

/** Display several numbers as +a, +b. */
export function formatWhatsAppDisplayList(value: string | string[]): string {
  const nums = parseWhatsAppNumbers(value);
  if (!nums.length) return "-";
  return nums.map((n) => `+${n}`).join(", ");
}

export const WhatsAppClickToChatLimits = {
  MIN_DIGITS,
  MAX_DIGITS,
  MAX_RECIPIENTS,
} as const;
