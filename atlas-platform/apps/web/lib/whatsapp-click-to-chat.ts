/**
 * Manual WhatsApp click-to-chat helpers (NOT Evolution API).
 * Hardened for True Mode: digit normalization + E.164 length gate.
 */

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/** Strip to digits only. Returns empty string if outside E.164 length bounds. */
export function normalizeWhatsAppNumber(value: string): string {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return "";
  return digits;
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

export const WhatsAppClickToChatLimits = { MIN_DIGITS, MAX_DIGITS } as const;
