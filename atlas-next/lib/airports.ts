import { AIRPORTS, type AirportRecord } from "./airports-data";

export type { AirportRecord };

/** Home markets — always float above equal-quality world matches (Bahrain HCM). */
export const PRIORITY_COUNTRIES = new Set(["IN", "PK"]);

const TYPE_RANK: Record<string, number> = {
  large_airport: 0,
  medium_airport: 1,
  small_airport: 2,
};

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India",
  PK: "Pakistan",
  BH: "Bahrain",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  QA: "Qatar",
  KW: "Kuwait",
  OM: "Oman",
  EG: "Egypt",
  JO: "Jordan",
  LB: "Lebanon",
  TR: "Turkey",
  GB: "United Kingdom",
  US: "United States",
  CA: "Canada",
  FR: "France",
  DE: "Germany",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  CH: "Switzerland",
  AT: "Austria",
  BE: "Belgium",
  IE: "Ireland",
  PT: "Portugal",
  GR: "Greece",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  PL: "Poland",
  CZ: "Czechia",
  RU: "Russia",
  CN: "China",
  JP: "Japan",
  KR: "South Korea",
  HK: "Hong Kong",
  TW: "Taiwan",
  SG: "Singapore",
  MY: "Malaysia",
  TH: "Thailand",
  ID: "Indonesia",
  PH: "Philippines",
  VN: "Vietnam",
  BD: "Bangladesh",
  LK: "Sri Lanka",
  NP: "Nepal",
  MM: "Myanmar",
  AU: "Australia",
  NZ: "New Zealand",
  ZA: "South Africa",
  NG: "Nigeria",
  KE: "Kenya",
  ET: "Ethiopia",
  MA: "Morocco",
  TN: "Tunisia",
  IQ: "Iraq",
  IR: "Iran",
  AF: "Afghanistan",
  BR: "Brazil",
  MX: "Mexico",
  AR: "Argentina",
};

export function countryFlagHint(country: string): string {
  return COUNTRY_NAMES[country] || country;
}

export function airportLabel(a: AirportRecord): string {
  return `${a.code} — ${a.city}${a.name && a.name !== a.city ? ` (${a.name})` : ""}`;
}

export function findAirport(code: string): AirportRecord | undefined {
  const needle = code.trim().toUpperCase();
  if (!needle) return undefined;
  return AIRPORTS.find((a) => a.code === needle);
}

function countryPriority(country: string): number {
  if (country === "IN") return 0;
  if (country === "PK") return 1;
  if (country === "BH") return 2;
  if (country === "AE") return 3;
  return 10;
}

function typeRank(type: string): number {
  return TYPE_RANK[type] ?? 9;
}

/** Tiny Levenshtein for typo tolerance (FareLens-style tier 5). Cap cost. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/**
 * Match quality tiers inspired by Skyscanner autosuggest + FareLens 5-tier search:
 * 0 exact IATA → 1 IATA prefix → 2 city exact → 3 city prefix →
 * 4 city/name contains → 5 fuzzy city (typos).
 * Within a tier: India & Pakistan first, then larger hubs, then A–Z city.
 */
function matchTier(a: AirportRecord, q: string): number | null {
  const code = a.code.toLowerCase();
  const city = a.city.toLowerCase();
  const name = a.name.toLowerCase();

  if (code === q) return 0;
  if (code.startsWith(q)) return 1;
  if (city === q) return 2;
  if (city.startsWith(q)) return 3;
  if (city.includes(q) || name.startsWith(q)) return 4;
  if (name.includes(q)) return 4.5;
  // Fuzzy only for longer queries to avoid noise (typo tolerance)
  if (q.length >= 4 && city.length >= 3) {
    const target = city.length <= q.length + 2 ? city : city.slice(0, q.length + 1);
    const dCity = editDistance(q, target);
    if (dCity <= 1) return 5;
    if (dCity <= 2 && q.length >= 6) return 5.5;
  }
  return null;
}

function sortKey(a: AirportRecord, tier: number): [number, number, number, string, string] {
  return [tier, countryPriority(a.country), typeRank(a.type), a.city.toLowerCase(), a.code];
}

export type AirportSearchGroup = {
  id: "priority" | "world";
  label: string;
  items: AirportRecord[];
};

/** Empty-state browse: featured IN/PK + GCC first, then remaining priority, then world hubs. */
function browseDefaults(limit: number): AirportRecord[] {
  const featured = [
    "DEL",
    "BOM",
    "BLR",
    "MAA",
    "HYD",
    "CCU",
    "COK",
    "AMD",
    "PNQ",
    "GOI",
    "TRV",
    "KHI",
    "LHE",
    "ISB",
    "PEW",
    "SKT",
    "MUX",
    "BAH",
    "DXB",
    "AUH",
    "DOH",
    "RUH",
    "JED",
  ];
  const out: AirportRecord[] = [];
  const seen = new Set<string>();
  const push = (a: AirportRecord | undefined) => {
    if (!a || seen.has(a.code)) return;
    seen.add(a.code);
    out.push(a);
  };

  for (const code of featured) {
    push(AIRPORTS.find((a) => a.code === code));
    if (out.length >= limit) return out;
  }

  const priority = AIRPORTS.filter((a) => PRIORITY_COUNTRIES.has(a.country)).sort(
    (a, b) =>
      typeRank(a.type) - typeRank(b.type) ||
      countryPriority(a.country) - countryPriority(b.country) ||
      a.city.localeCompare(b.city)
  );
  const worldLarge = AIRPORTS.filter(
    (a) => !PRIORITY_COUNTRIES.has(a.country) && a.type === "large_airport"
  ).sort((a, b) => a.city.localeCompare(b.city) || a.code.localeCompare(b.code));

  for (const list of [priority, worldLarge, AIRPORTS]) {
    for (const a of list) {
      push(a);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Flat ranked list (used by combobox). */
export function searchAirports(query: string, limit = 40): AirportRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return browseDefaults(limit);

  const scored: { a: AirportRecord; tier: number }[] = [];
  for (const a of AIRPORTS) {
    const tier = matchTier(a, q);
    if (tier == null) continue;
    scored.push({ a, tier });
  }
  scored.sort((x, y) => {
    const kx = sortKey(x.a, x.tier);
    const ky = sortKey(y.a, y.tier);
    for (let i = 0; i < kx.length; i++) {
      if (kx[i] < ky[i]) return -1;
      if (kx[i] > ky[i]) return 1;
    }
    return 0;
  });
  return scored.slice(0, limit).map((s) => s.a);
}

/** Grouped results for UI section headers (India & Pakistan / Worldwide). */
export function searchAirportsGrouped(query: string, limit = 50): AirportSearchGroup[] {
  const items = searchAirports(query, limit);
  const priority = items.filter((a) => PRIORITY_COUNTRIES.has(a.country));
  const world = items.filter((a) => !PRIORITY_COUNTRIES.has(a.country));
  const groups: AirportSearchGroup[] = [];
  if (priority.length) {
    groups.push({
      id: "priority",
      label: query.trim() ? "India & Pakistan" : "India & Pakistan (priority)",
      items: priority,
    });
  }
  if (world.length) {
    groups.push({
      id: "world",
      label: query.trim() ? "Worldwide" : "Worldwide hubs",
      items: world,
    });
  }
  return groups;
}

export const AIRPORT_CATALOG_STATS = {
  total: AIRPORTS.length,
  india: AIRPORTS.filter((a) => a.country === "IN").length,
  pakistan: AIRPORTS.filter((a) => a.country === "PK").length,
};
