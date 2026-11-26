/** SAP-style report toolbar helpers — export filenames and density persistence. */

export type ReportDensity = "compact" | "comfortable";

const DENSITY_KEY = "atlas.reportDensity";

export function loadReportDensity(): ReportDensity {
  if (typeof window === "undefined") return "compact";
  try {
    return sessionStorage.getItem(DENSITY_KEY) === "comfortable" ? "comfortable" : "compact";
  } catch {
    return "compact";
  }
}

export function saveReportDensity(density: ReportDensity): void {
  try {
    sessionStorage.setItem(DENSITY_KEY, density);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Safe download stem: "Airfare Allocation-2026-11-22". */
export function reportExportFilename(
  label: string,
  format: "xlsx" | "pdf",
  asOfOrPeriod?: string
): string {
  const stem = label
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  const stamp = (asOfOrPeriod || "").replace(/[^\d-]+/g, "").slice(0, 10);
  return `${stem || "report"}${stamp ? `-${stamp}` : ""}.${format}`;
}
