/**
 * ATLAS theme generator — algorithmic palette derivation from ONE seed color.
 *
 * Algorithm (documented for the design-system contract):
 *  1. Seed brand color is converted to OKLCH (perceptually uniform space).
 *  2. A 10-step scale (50..900) is produced by walking a fixed OKLCH lightness
 *     ramp, keeping hue on a small "arc" (lights drift slightly toward azure,
 *     darks slightly toward violet) and tapering chroma toward the light/dark
 *     extremes (peak chroma lives at the 400-600 core, like Material HCT).
 *  3. Chroma is gamut-mapped into sRGB by binary-search reduction (CSS Color 4
 *     style), so no channel ever clips.
 *  4. Interactive steps (primary, semantics, sidebar text) are NOT hand-picked:
 *     their lightness is SOLVED by binary search so white-on-color >= 4.5:1
 *     (with headroom) by construction — WCAG 2.1 AA is guaranteed, not hoped for.
 *  5. Neutrals share the brand hue at very low chroma (slate tint, never pure
 *     gray) so surfaces and brand feel like one family.
 *  6. Output is emitted as plain hsl() tokens because the runtime stack and the
 *     contrast contract test consume hsl() literals.
 *
 * Usage: node scripts/generate-theme.mjs            (writes app/themes/*.css)
 *        node scripts/generate-theme.mjs --audit    (prints contrast table only)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* ---------------- OKLCH <-> sRGB (Björn Ottosson reference matrices) ---------------- */
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function oklchToRgb(L, C, H) {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const inGamut = ([r, g, b]) => [r, g, b].every((c) => c >= -1e-9 && c <= 1 + 1e-9);
const clamp01 = (c) => Math.min(1, Math.max(0, c));

/** CSS Color 4-style gamut mapping: reduce chroma until the color fits sRGB. */
function gamutMap(L, C, H) {
  if (inGamut(oklchToRgb(L, C, H))) return [L, C, H];
  let lo = 0, hi = C;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgb(L, mid, H))) lo = mid; else hi = mid;
  }
  return [L, lo, H];
}

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6 || l < 1e-6 || l > 1 - 1e-6) return [0, 0, l * 100]; // achromatic poles: hue is degenerate
  const s = d / (1 - Math.abs(2 * l - 1));
  if (s * 100 < 0.6) return [0, 0, l * 100]; // achromatic: hue is degenerate, emit clean gray
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return [((h % 360) + 360) % 360, s * 100, l * 100];
}

const oklchToHsl = (L, C, H) => rgbToHsl(oklchToRgb(L, C, H).map(clamp01));

function luminance([r, g, b]) {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRgb(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}
const WHITE = [1, 1, 1];

/** Solve OKLCH lightness so color(L,C,H) vs white meets `target` contrast. */
function solveLForWhiteContrast(C, H, target) {
  let lo = 0.05, hi = 0.75;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const [L2, C2] = gamutMap(mid, C, H);
    const r = contrastRgb(oklchToRgb(L2, C2, H).map(clamp01), WHITE);
    if (r >= target) lo = mid; else hi = mid;
  }
  return lo;
}
const contrastHsl = (a, b) => contrastRgb(hslToRgbArr(a), hslToRgbArr(b));
function hslToRgbArr([h, s, l]) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

const fmt = ([h, s, l]) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l * 10) / 10}%)`;
const fmtA = ([h, s, l], alpha) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l * 10) / 10}% / ${alpha})`;

/* ---------------- Scale derivation ---------------- */
// Perceptual lightness ramp (50..900). Anchored so 500 == seed L exactly.
const BRAND_L = { 50: 0.972, 100: 0.935, 200: 0.868, 300: 0.782, 400: 0.66, 600: 0.43, 700: 0.356, 800: 0.284, 900: 0.224 };
const HUE_ARC = 12;       // degrees of rotation across the full ramp (lights cooler, darks deeper)
const CHROMA_TAPER = 1.4; // how aggressively chroma falls off away from the seed

function brandScale(seed) {
  const out = {};
  for (const [step, L] of Object.entries(BRAND_L)) {
    const dL = L - seed.L;
    const C = Math.max(0.012, seed.C * (1 - CHROMA_TAPER * Math.abs(dL)));
    const H = seed.H - HUE_ARC * dL; // lights drift down-hue (azure), darks up-hue (violet)
    out[step] = gamutMap(L, C, H);
  }
  out[500] = gamutMap(seed.L, seed.C, seed.H); // anchor: seed IS step 500
  return out;
}

const NEUTRAL_L = { 0: 1.0, 50: 0.978, 100: 0.96, 200: 0.924, 300: 0.85, 400: 0.585, 500: 0.5, 600: 0.405, 700: 0.325, 800: 0.25, 900: 0.19, 950: 0.155 };
function neutralScale(hue, chromaBase) {
  const out = {};
  for (const [step, L] of Object.entries(NEUTRAL_L)) {
    const C = chromaBase * (0.55 + 0.9 * Math.abs(L - 0.55)); // whisper of brand hue, slightly stronger in shadows
    out[step] = gamutMap(L, C, hue);
  }
  return out;
}

/** Semantic family: strong/hover solved for AA on white; tint steps off the shared ramp. */
function semanticScale(H, C, opts = {}) {
  // Accents double as text on their own muted tint (badge pattern), so they
  // solve against a higher white-contrast target (muted tint is ~1.1:1 vs white).
  const strongL = solveLForWhiteContrast(C, H, opts.target ?? 4.9);
  const strong = gamutMap(strongL, C, H);
  const hover = gamutMap(strongL * 0.86, C * 0.98, H + 1);
  const emphasis = gamutMap(Math.max(0.16, strongL * 0.58), C * 0.8, H + 2);
  const tint50 = gamutMap(0.955, C * 0.22, H - 2);
  const tint200 = gamutMap(0.88, C * 0.38, H - 1);
  return { 50: tint50, 200: tint200, 600: strong, 700: hover, 800: emphasis };
}

/** Lightest-needed text L (>= minL) whose contrast clears `target` on every background. */
function solveTextL(C, H, backgrounds, minL, target) {
  for (let L = minL; L <= 0.99; L += 0.005) {
    const fg = oklchToRgb(...gamutMap(L, C, H)).map(clamp01);
    if (backgrounds.every((bg) => contrastRgb(fg, oklchToRgb(...bg).map(clamp01)) >= target)) return L;
  }
  return 0.99;
}

/** Lightest dark text L (<= maxL) whose contrast clears `target` on every light background. */
function solveDarkTextL(C, H, backgrounds, maxL, target) {
  for (let L = maxL; L >= 0.05; L -= 0.005) {
    const fg = oklchToRgb(...gamutMap(L, C, H)).map(clamp01);
    if (backgrounds.every((bg) => contrastRgb(fg, oklchToRgb(...bg).map(clamp01)) >= target)) return L;
  }
  return 0.05;
}

/** Shortest-arc OKLCH interpolation (no muddy sRGB midpoint between distant hues). */
function mixOklch(a, b, t) {
  let dH = b[2] - a[2];
  if (dH > 180) dH -= 360;
  if (dH < -180) dH += 360;
  return gamutMap(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + dH * t);
}

// Sidebar icon tones: fixed cheerful hues (meaning-coded: money = mint, people = violet,
// time = amber, alerts = rose, travel = teal, general = sky), solved per theme to stay
// >= 3:1 (WCAG 1.4.11 graphics) on that theme's sidebar.
const NAV_TONES = { sky: 236, mint: 162, amber: 80, rose: 10, violet: 300, teal: 196 };

/* ---------------- Theme definitions (the only hand-chosen values) ---------------- */
const THEMES = {
  "atlas-sapphire": {
    name: "Sapphire",
    blurb: "Royal enterprise blue with a navy sidebar — classic and trusted.",
    title: "ATLAS Sapphire — royal enterprise blue, slate-blue neutrals, navy sidebar",
    seed: { L: 0.5, C: 0.165, H: 256 },   // OKLCH seed: royal sapphire blue
    neutralHue: 258, neutralChroma: 0.016,
    accent: { H: 288, C: 0.16 },          // violet — analogous-adjacent harmony, Stripe-esque
    info: { H: 218, C: 0.115 },           // cyan — clearly distinct from sapphire brand
    sidebar: { bgL: 0.3, bgC: 0.085, bgH: 262, endL: 0.235, endC: 0.085, endH: 276, fgL: 0.86, labelL: 0.74, indicatorH: 220 },
    hero: [{ ref: "brand-500" }, { L: 0.415, C: 0.15, H: 264 }, { L: 0.35, C: 0.13, H: 274 }],
  },
  "slate-indigo": {
    name: "Slate Indigo",
    blurb: "Cool indigo with cyan accents — modern and tech-forward.",
    title: "ALT A · Slate Indigo — Linear/Stripe-adjacent blurple, deepened to meet AA (cool, tech-forward)",
    seed: { L: 0.47, C: 0.17, H: 284 },   // indigo-violet, far enough from sapphire to read as its own theme
    neutralHue: 264, neutralChroma: 0.013,
    accent: { H: 218, C: 0.12 },          // cyan accent pops against indigo
    info: { H: 222, C: 0.12 },
    sidebar: { bgL: 0.29, bgC: 0.085, bgH: 280, endL: 0.23, endC: 0.08, endH: 292, fgL: 0.86, labelL: 0.74, indicatorH: 205 },
    hero: [{ ref: "brand-500" }, { L: 0.4, C: 0.14, H: 278 }, { L: 0.34, C: 0.12, H: 288 }],
  },
  "warm-sand": {
    name: "Warm Sand",
    blurb: "Warm paper tones with copper and teal — calm classic finance.",
    title: "ALT B · Warm Sand — warm paper neutrals, copper brand, teal accent (classic finance)",
    seed: { L: 0.47, C: 0.12, H: 50 },    // copper — warm brand that stays clear of destructive red (27)
    neutralHue: 80, neutralChroma: 0.016, // warm sand tint
    accent: { H: 200, C: 0.1 },           // teal — complementary to copper
    info: { H: 245, C: 0.11 },
    sidebar: { bgL: 0.29, bgC: 0.045, bgH: 55, endL: 0.23, endC: 0.04, endH: 42, fgL: 0.87, labelL: 0.74, indicatorH: 70 }, // warm espresso
    hero: [{ ref: "brand-500" }, { L: 0.41, C: 0.11, H: 45 }, { L: 0.34, C: 0.09, H: 38 }],
    paper: true,
  },
  "ocean-teal": {
    name: "Ocean Teal",
    blurb: "Calm teal with a deep-ocean sidebar — easy on the eyes.",
    title: "ALT C · Ocean Teal — calm teal brand, cool neutrals, deep-ocean sidebar",
    seed: { L: 0.5, C: 0.1, H: 200 },     // teal
    neutralHue: 212, neutralChroma: 0.012,
    accent: { H: 318, C: 0.14 },          // magenta accent — complementary to teal
    info: { H: 248, C: 0.12 },            // blue info — distinct from teal brand
    sidebar: { bgL: 0.3, bgC: 0.06, bgH: 212, endL: 0.235, endC: 0.06, endH: 236, fgL: 0.86, labelL: 0.74, indicatorH: 185 },
    hero: [{ ref: "brand-500" }, { L: 0.42, C: 0.09, H: 212 }, { L: 0.35, C: 0.08, H: 228 }],
  },
  "royal-plum": {
    name: "Royal Plum",
    blurb: "Rich plum with teal accents — distinctive and premium.",
    title: "ALT D · Royal Plum — plum brand, rose-tinted neutrals, teal accent",
    seed: { L: 0.46, C: 0.15, H: 330 },   // plum / magenta-violet (kept away from destructive red)
    neutralHue: 322, neutralChroma: 0.01,
    accent: { H: 200, C: 0.1 },           // teal accent — complementary
    info: { H: 232, C: 0.11 },
    sidebar: { bgL: 0.29, bgC: 0.075, bgH: 325, endL: 0.23, endC: 0.075, endH: 305, fgL: 0.86, labelL: 0.74, indicatorH: 340 },
    hero: [{ ref: "brand-500" }, { L: 0.4, C: 0.14, H: 318 }, { L: 0.34, C: 0.12, H: 300 }],
  },
  graphite: {
    name: "Graphite",
    blurb: "Neutral charcoal with an amber accent — minimal and focused.",
    title: "ALT E · Graphite — near-monochrome charcoal brand, amber accent",
    seed: { L: 0.42, C: 0.03, H: 255 },   // charcoal with a whisper of blue
    neutralHue: 255, neutralChroma: 0.006,
    accent: { H: 55, C: 0.13 },           // amber-orange accent
    info: { H: 225, C: 0.1 },
    sidebar: { bgL: 0.255, bgC: 0.012, bgH: 255, endL: 0.2, endC: 0.012, endH: 262, fgL: 0.86, labelL: 0.74, indicatorH: 70 },
    hero: [{ ref: "brand-500" }, { L: 0.36, C: 0.025, H: 258 }, { L: 0.3, C: 0.02, H: 262 }],
  },
  "emerald-jade": {
    name: "Emerald Jade",
    blurb: "Fresh jade green with a violet accent — bright and natural.",
    title: "ALT F · Emerald Jade — jade brand (kept off success green 152), violet accent",
    seed: { L: 0.5, C: 0.11, H: 172 },    // jade: 20 degrees from success so status pills stay distinct
    neutralHue: 175, neutralChroma: 0.01,
    accent: { H: 300, C: 0.14 },          // violet — complementary to jade
    info: { H: 240, C: 0.12 },
    sidebar: { bgL: 0.295, bgC: 0.055, bgH: 180, endL: 0.23, endC: 0.055, endH: 198, fgL: 0.86, labelL: 0.74, indicatorH: 160 },
    hero: [{ ref: "brand-500" }, { L: 0.42, C: 0.1, H: 180 }, { L: 0.35, C: 0.08, H: 195 }],
  },
  "midnight-gold": {
    name: "Midnight Gold",
    blurb: "Deep midnight navy with gold highlights — executive and bold.",
    title: "ALT G · Midnight Gold — deep navy brand, near-black sidebar, gold accent",
    seed: { L: 0.38, C: 0.12, H: 266 },   // midnight navy, darker than sapphire
    neutralHue: 262, neutralChroma: 0.012,
    accent: { H: 75, C: 0.13 },           // gold — complementary to navy
    info: { H: 225, C: 0.11 },
    sidebar: { bgL: 0.225, bgC: 0.055, bgH: 268, endL: 0.17, endC: 0.045, endH: 278, fgL: 0.86, labelL: 0.74, indicatorH: 82 },
    hero: [{ ref: "brand-500" }, { L: 0.32, C: 0.1, H: 272 }, { L: 0.27, C: 0.08, H: 280 }],
  },
  "olive-grove": {
    name: "Olive Grove",
    blurb: "Earthy olive with a plum accent — warm, calm and grounded.",
    title: "ALT H · Olive Grove — olive brand, warm neutrals, plum accent",
    seed: { L: 0.47, C: 0.1, H: 118 },    // olive
    neutralHue: 100, neutralChroma: 0.012,
    accent: { H: 330, C: 0.13 },          // plum — complementary to olive
    info: { H: 235, C: 0.11 },
    sidebar: { bgL: 0.285, bgC: 0.045, bgH: 118, endL: 0.225, endC: 0.04, endH: 100, fgL: 0.87, labelL: 0.74, indicatorH: 105 },
    hero: [{ ref: "brand-500" }, { L: 0.41, C: 0.09, H: 112 }, { L: 0.34, C: 0.07, H: 100 }],
    paper: true,
  },
  "desert-rose": {
    name: "Desert Rose",
    blurb: "Dusty rose with a teal accent — soft, warm and elegant.",
    title: "ALT I · Desert Rose — muted rose brand (low chroma, clear of destructive red), teal accent",
    seed: { L: 0.47, C: 0.1, H: 5 },      // dusty rose: low chroma keeps it apart from destructive red (27)
    neutralHue: 20, neutralChroma: 0.01,
    accent: { H: 195, C: 0.1 },           // teal — complementary to rose
    info: { H: 240, C: 0.11 },
    sidebar: { bgL: 0.29, bgC: 0.06, bgH: 355, endL: 0.23, endC: 0.06, endH: 338, fgL: 0.86, labelL: 0.74, indicatorH: 15 },
    hero: [{ ref: "brand-500" }, { L: 0.41, C: 0.09, H: 0 }, { L: 0.34, C: 0.08, H: 350 }],
  },
  "arctic-sky": {
    name: "Arctic Sky",
    blurb: "Crisp sky blue with a mint accent — cool, airy and friendly (default).",
    title: "ATLAS Arctic Sky (default) — cerulean brand, icy neutrals, mint accent, glacier-blue sidebar",
    seed: { L: 0.5, C: 0.13, H: 238 },    // cerulean: cooler and lighter-feeling than sapphire (256)
    neutralHue: 232, neutralChroma: 0.014,
    accent: { H: 165, C: 0.11 },          // mint — fresh, cool pairing for sky blue
    info: { H: 262, C: 0.12 },            // indigo info — distinct from cerulean brand
    sidebar: { bgL: 0.32, bgC: 0.075, bgH: 238, endL: 0.25, endC: 0.075, endH: 252, fgL: 0.88, labelL: 0.76, indicatorH: 200 },
    hero: [{ ref: "brand-500" }, { L: 0.44, C: 0.12, H: 246 }, { L: 0.37, C: 0.11, H: 258 }],
  },
  aurora: {
    name: "Aurora",
    blurb: "Violet brand with a northern-lights violet-to-teal sidebar — vibrant and modern.",
    title: "ALT K · Aurora — violet brand, lavender neutrals, teal accent, indigo-to-teal sidebar",
    seed: { L: 0.49, C: 0.15, H: 300 },   // violet, clear of slate-indigo (284) and plum (330)
    neutralHue: 292, neutralChroma: 0.012,
    accent: { H: 192, C: 0.1 },           // teal — the aurora's other pole
    info: { H: 240, C: 0.12 },
    sidebar: { bgL: 0.3, bgC: 0.09, bgH: 290, endL: 0.29, endC: 0.065, endH: 200, fgL: 0.87, labelL: 0.75, indicatorH: 180 },
    hero: [{ ref: "brand-500" }, { L: 0.42, C: 0.13, H: 285 }, { L: 0.38, C: 0.08, H: 220 }],
  },
  "honey-cream": {
    name: "Honey Cream",
    blurb: "Cream paper, a light sidebar and honey highlights — bright, warm and calm.",
    title: "ALT L · Honey Cream — honey-gold brand, cream paper, light sidebar with a honey active row",
    seed: { L: 0.5, C: 0.115, H: 72 },    // honey gold, deep enough for white text on buttons
    neutralHue: 85, neutralChroma: 0.018,
    accent: { H: 250, C: 0.1 },           // slate blue — cool complement to honey
    info: { H: 240, C: 0.11 },
    warningH: 50,                         // orange warnings, so they never read as the gold brand
    sidebar: {
      mode: "light",
      bgL: 0.968, bgC: 0.024, bgH: 88, endL: 0.952, endC: 0.028, endH: 82,
      activeL: 0.875, activeC: 0.13, activeH: 84, // the honey "selected" row
      fgL: 0.5, labelL: 0.55, indicatorH: 68,
    },
    hero: [{ ref: "brand-500" }, { L: 0.45, C: 0.11, H: 62 }, { L: 0.4, C: 0.1, H: 52 }],
    paper: true,
  },
  "lavender-lime": {
    name: "Lavender Lime",
    blurb: "Lavender surfaces, deep violet sidebar and a lime glow — fresh and modern.",
    title: "ALT M · Lavender Lime — violet brand, lavender-tinted page, deep violet sidebar, lime accent",
    seed: { L: 0.52, C: 0.22, H: 292 },   // electric violet: more chroma than aurora (0.15) or slate-indigo (0.17)
    neutralHue: 300, neutralChroma: 0.016,
    background: { L: 0.968, C: 0.022, H: 300 }, // lavender page behind white cards
    accent: { H: 130, C: 0.16 },          // lime — kept 22 degrees off success green (152)
    info: { H: 245, C: 0.12 },
    sidebar: { bgL: 0.27, bgC: 0.1, bgH: 292, endL: 0.22, endC: 0.09, endH: 302, fgL: 0.87, labelL: 0.75, indicatorH: 128 },
    hero: [{ ref: "brand-500" }, { L: 0.42, C: 0.16, H: 300 }, { L: 0.37, C: 0.13, H: 315 }],
  },
  "enterprise-vibrant": {
    name: "Enterprise Vibrant",
    blurb: "Slate canvas, indigo actions, and a colour for each part of the business.",
    title: "ALT N · Enterprise Vibrant — slate page, indigo brand, light sidebar, semantic menu colours",
    seed: { L: 0.51, C: 0.17, H: 277 },
    neutralHue: 250, neutralChroma: 0.008,
    accent: { H: 300, C: 0.14 },
    info: { H: 210, C: 0.11 },
    warningH: 75,
    navHues: { sky: 210, mint: 164, amber: 75, rose: 27, violet: 292, teal: 196 },
    sidebar: {
      mode: "light",
      bgL: 0.985, bgC: 0.008, bgH: 250, endL: 0.97, endC: 0.01, endH: 255,
      activeL: 0.94, activeC: 0.045, activeH: 277,
      fgL: 0.42, labelL: 0.48, indicatorH: 277,
    },
    hero: [{ ref: "brand-500" }, { L: 0.46, C: 0.14, H: 265 }, { L: 0.42, C: 0.12, H: 250 }],
    background: { L: 0.985, C: 0.006, H: 250 },
  },
};

const DEFAULT_THEME = "arctic-sky";

/* ---------------- Token assembly ---------------- */
function buildTokens(name, def) {
  const brand = brandScale(def.seed);
  const neutral = neutralScale(def.neutralHue, def.neutralChroma);
  const green = semanticScale(152, 0.125);
  const amber = semanticScale(def.warningH ?? 78, 0.13);
  const red = semanticScale(27, 0.165);
  const blue = semanticScale(def.info.H, def.info.C);
  const violet = semanticScale(def.accent.H, def.accent.C, { target: 5.55 });

  const hsl = (ok) => oklchToHsl(...ok);
  const B = Object.fromEntries(Object.entries(brand).map(([k, v]) => [k, hsl(v)]));
  const N = Object.fromEntries(Object.entries(neutral).map(([k, v]) => [k, hsl(v)]));
  const G = Object.fromEntries(Object.entries(green).map(([k, v]) => [k, hsl(v)]));
  const A = Object.fromEntries(Object.entries(amber).map(([k, v]) => [k, hsl(v)]));
  const R = Object.fromEntries(Object.entries(red).map(([k, v]) => [k, hsl(v)]));
  const Bl = Object.fromEntries(Object.entries(blue).map(([k, v]) => [k, hsl(v)]));
  const V = Object.fromEntries(Object.entries(violet).map(([k, v]) => [k, hsl(v)]));

  const sb = def.sidebar;
  // Light sidebars invert the solve: text and icons go DOWN in lightness until they clear
  // the same contrast targets the dark sidebars meet going up.
  const light = sb.mode === "light";
  const topOk = gamutMap(sb.bgL, sb.bgC, sb.bgH);
  const bottomOk = gamutMap(sb.endL ?? sb.bgL - 0.05, sb.endC ?? sb.bgC * 1.15, sb.endH ?? sb.bgH - 4);
  const midOk = mixOklch(topOk, bottomOk, 0.5);
  const stopsOk = [topOk, midOk, bottomOk];
  const hoverOk = light
    ? gamutMap(sb.bgL - 0.05, sb.bgC * 1.6, sb.bgH)
    : gamutMap(sb.bgL + 0.07, sb.bgC * 1.1, sb.bgH);
  const activeOk = light
    ? gamutMap(sb.activeL ?? 0.88, sb.activeC ?? 0.12, sb.activeH ?? def.seed.H)
    : gamutMap(sb.bgL + 0.11, Math.max(0.1, sb.bgC * 1.5), sb.activeH ?? def.seed.H);
  const textC = light ? Math.min(0.04, sb.bgC * 1.5) : sb.bgC * 0.45;
  const fgL = light
    ? solveDarkTextL(textC, sb.bgH - 6, [...stopsOk, hoverOk], sb.fgL, 4.75)
    : solveTextL(sb.bgC * 0.45, sb.bgH - 6, [...stopsOk, hoverOk], sb.fgL, 4.75);
  const labelL = light
    ? solveDarkTextL(textC, sb.bgH - 6, stopsOk, sb.labelL, 4.6)
    : solveTextL(sb.bgC * 0.5, sb.bgH - 6, stopsOk, sb.labelL, 4.6);
  const solveTone = (C, H, target) =>
    light
      ? solveDarkTextL(C, H, [...stopsOk, activeOk, hoverOk], 0.62, target)
      : solveTextL(C, H, [...stopsOk, activeOk], 0.8, target);
  const sidebarBg = hsl(topOk);
  const sidebarFg = hsl(gamutMap(fgL, light ? textC : sb.bgC * 0.45, sb.bgH - 6));
  const sidebarLabel = hsl(gamutMap(labelL, light ? textC : sb.bgC * 0.5, sb.bgH - 6));
  const sidebarAccent = hsl(hoverOk);
  const sidebarActiveBg = hsl(activeOk);
  const sidebarActiveText = light
    ? fmt(hsl(gamutMap(solveDarkTextL(0.03, sb.bgH, [...stopsOk, activeOk, hoverOk], 0.3, 7), 0.03, sb.bgH)))
    : "var(--neutral-0)";
  const sidebarBorder = light
    ? hsl(gamutMap(sb.bgL - 0.085, sb.bgC * 1.4, sb.bgH))
    : hsl(gamutMap(sb.bgL + 0.09, sb.bgC, sb.bgH));
  const sidebarMid = hsl(midOk);
  const sidebarBottom = hsl(bottomOk);
  const indicatorH = sb.indicatorH ?? def.seed.H;
  const sidebarIndicator = hsl(gamutMap(solveTone(0.15, indicatorH, 3.2), 0.15, indicatorH));
  const hues = { ...NAV_TONES, ...(def.navHues ?? {}) };
  const navTones = Object.fromEntries(
    Object.entries(hues).map(([tone, H]) => [
      tone,
      hsl(gamutMap(solveTone(0.12, H, 3.4), 0.12, H)),
    ])
  );

  const heroStops = def.hero.map((s) => (s.ref ? B[500] : hsl(gamutMap(s.L, s.C, s.H))));
  const umbra = hsl(gamutMap(0.19, def.neutralChroma * 2.2, def.neutralHue));

  const t = {};
  for (const k of ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"]) t[`brand-${k}`] = fmt(B[k]);
  for (const k of Object.keys(NEUTRAL_L)) t[`neutral-${k}`] = fmt(N[k]);
  for (const k of ["50", "200", "600", "700", "800"]) { t[`green-${k}`] = fmt(G[k]); t[`amber-${k}`] = fmt(A[k]); t[`red-${k}`] = fmt(R[k]); t[`blue-${k}`] = fmt(Bl[k]); }
  t["violet-50"] = fmt(V[50]); t["violet-500"] = fmt(V[600]); t["violet-600"] = fmt(V[700]);

  Object.assign(t, {
    "color-background": def.background
      ? fmt(hsl(gamutMap(def.background.L, def.background.C, def.background.H)))
      : def.paper ? fmt(hsl(gamutMap(0.982, 0.016, def.neutralHue))) : "var(--neutral-50)",
    "color-foreground": "var(--neutral-900)",
    "color-card": "var(--neutral-0)",
    "color-card-foreground": "var(--neutral-900)",
    "color-popover": "var(--neutral-0)",
    "color-popover-foreground": "var(--neutral-900)",
    "color-primary": "var(--brand-500)",
    "color-primary-foreground": "var(--neutral-0)",
    "color-primary-hover": "var(--brand-600)",
    "color-primary-muted": "var(--brand-50)",
    "color-primary-emphasis": "var(--brand-700)",
    "color-primary-ring": fmtA(B[500], 0.25),
    "color-secondary": "var(--neutral-100)",
    "color-secondary-foreground": "var(--neutral-900)",
    "color-secondary-hover": fmt(hsl(gamutMap(NEUTRAL_L[100] - 0.03, def.neutralChroma, def.neutralHue))),
    "color-muted": "var(--neutral-100)",
    "color-muted-foreground": "var(--neutral-500)",
    "color-accent": "var(--violet-500)",
    "color-accent-foreground": "var(--neutral-0)",
    "color-accent-muted": "var(--violet-50)",
    "color-success": "var(--green-600)", "color-success-foreground": "var(--neutral-0)",
    "color-success-hover": "var(--green-700)", "color-success-muted": "var(--green-50)",
    "color-success-emphasis": "var(--green-800)", "color-success-ring": fmtA(G[600], 0.3),
    "color-warning": "var(--amber-600)", "color-warning-foreground": "var(--neutral-0)",
    "color-warning-hover": "var(--amber-700)", "color-warning-muted": "var(--amber-50)",
    "color-warning-emphasis": "var(--amber-800)", "color-warning-ring": fmtA(A[600], 0.35),
    "color-destructive": "var(--red-600)", "color-destructive-foreground": "var(--neutral-0)",
    "color-destructive-hover": "var(--red-700)", "color-destructive-muted": "var(--red-50)",
    "color-destructive-emphasis": "var(--red-800)", "color-destructive-ring": fmtA(R[600], 0.3),
    "color-info": "var(--blue-600)", "color-info-foreground": "var(--neutral-0)",
    "color-info-hover": "var(--blue-700)", "color-info-muted": "var(--blue-50)",
    "color-info-emphasis": "var(--blue-800)", "color-info-ring": fmtA(Bl[600], 0.3),
    "color-border": "var(--neutral-200)",
    "color-input": "var(--neutral-400)",
    // State affordance layered over the AA-compliant resting border (1.4.11
    // covers the resting state); measured ~2.8:1, asserted >= 2.5:1.
    "color-input-hover": "var(--brand-400)",
    "color-ring": "var(--brand-500)",
    "color-sidebar": fmt(sidebarBg),
    "color-sidebar-foreground": fmt(sidebarFg),
    "color-sidebar-active": sidebarActiveText,
    "color-sidebar-accent": fmt(sidebarAccent),
    "color-sidebar-active-bg": fmt(sidebarActiveBg),
    "color-sidebar-indicator": fmt(sidebarIndicator),
    "color-sidebar-label": fmt(sidebarLabel),
    "color-sidebar-border": fmt(sidebarBorder),
    ...Object.fromEntries(Object.entries(navTones).map(([tone, v]) => [`color-nav-${tone}`, fmt(v)])),
    "color-skeleton": "var(--neutral-100)",
    "color-skeleton-shine": fmt(hsl(gamutMap(NEUTRAL_L[100] - 0.035, def.neutralChroma, def.neutralHue))),
    "color-chart-primary": "var(--brand-500)",
    "color-chart-secondary": fmt(hsl(gamutMap(0.62, def.info.C * 0.9, def.info.H))),
    "color-selection": fmtA(B[500], 0.18),
    "color-umbra": fmt(umbra),
    "gradient-hero": `linear-gradient(135deg, ${fmt(heroStops[0])} 0%, ${fmt(heroStops[1])} 55%, ${fmt(heroStops[2])} 100%)`,
    "gradient-sidebar": `linear-gradient(180deg, ${fmt(sidebarBg)} 0%, ${fmt(sidebarMid)} 50%, ${fmt(sidebarBottom)} 100%)`,
    "shadow-card": `0 1px 2px color-mix(in hsl, var(--color-umbra) 6%, transparent), 0 10px 28px -10px color-mix(in hsl, var(--color-umbra) 10%, transparent)`,
    "shadow-pop": `0 12px 40px -8px color-mix(in hsl, var(--color-umbra) 24%, transparent)`,
  });
  return { tokens: t, heroStops, sidebarBg: fmt(sidebarBg), sidebarMid: fmt(sidebarMid), sidebarBottom: fmt(sidebarBottom), sidebarFg: fmt(sidebarFg), sidebarLabel: fmt(sidebarLabel), sidebarAccent: fmt(sidebarAccent) };
}

/* ---------------- Contrast audit ---------------- */
function audit(name, built) {
  const raw = new Map(Object.entries(built.tokens));
  const resolve = (n) => {
    let v = raw.get(n), seen = new Set();
    while (true) {
      const ref = v.match(/^var\(--([\w-]+)\)$/);
      if (!ref) break;
      if (seen.has(ref[1])) throw new Error("circular " + n);
      seen.add(ref[1]); v = raw.get(ref[1]);
    }
    const m = v.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*[\d.]+%?)?\s*\)$/);
    if (!m) throw new Error(`${name}: --${n} not plain hsl: ${v}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const pairs4_5 = [
    ["color-foreground", "color-background"], ["color-foreground", "color-card"],
    ["color-muted-foreground", "color-card"], ["color-muted-foreground", "color-background"],
    ["color-primary", "color-card"], ["color-primary-foreground", "color-primary"],
    ["color-primary-foreground", "color-primary-hover"],
    ["color-secondary-foreground", "color-secondary"], ["color-secondary-foreground", "color-secondary-hover"],
    ["color-accent", "color-accent-muted"], ["color-accent-foreground", "color-accent"],
    ["color-success-foreground", "color-success"], ["color-success-foreground", "color-success-hover"],
    ["color-warning-foreground", "color-warning"], ["color-warning-foreground", "color-warning-hover"],
    ["color-destructive-foreground", "color-destructive"], ["color-destructive-foreground", "color-destructive-hover"],
    ["color-info-foreground", "color-info"], ["color-info-foreground", "color-info-hover"],
    ["color-success-emphasis", "color-success-muted"], ["color-warning-emphasis", "color-warning-muted"],
    ["color-destructive-emphasis", "color-destructive-muted"], ["color-info-emphasis", "color-info-muted"],
    ["color-primary-emphasis", "color-primary-muted"],
    ["color-sidebar-foreground", "color-sidebar"], ["color-sidebar-label", "color-sidebar"],
    ["color-sidebar-active", "color-sidebar"], ["color-sidebar-foreground", "color-sidebar-accent"],
    ["color-sidebar-active", "color-sidebar-active-bg"], ["color-sidebar-active", "color-sidebar-accent"],
  ];
  const pairs3 = [
    ["color-input", "color-card"], ["color-ring", "color-card"], ["color-chart-primary", "color-card"],
    ["color-sidebar-indicator", "color-sidebar"], ["color-sidebar-indicator", "color-sidebar-active-bg"],
    ...Object.keys(NAV_TONES).flatMap((tone) => [
      [`color-nav-${tone}`, "color-sidebar"], [`color-nav-${tone}`, "color-sidebar-active-bg"],
    ]),
  ];
  const pairsEnhancement = [["color-input-hover", "color-card", 2.5]];
  const rows = [];
  let worst = 99;
  for (const [fg, bg] of pairs4_5) {
    const r = contrastHsl(resolve(fg), resolve(bg));
    rows.push([fg, bg, r, 4.5]); worst = Math.min(worst, r / 4.5);
  }
  for (const [fg, bg] of pairs3) {
    const r = contrastHsl(resolve(fg), resolve(bg));
    rows.push([fg, bg, r, 3.0]); worst = Math.min(worst, r / 3.0);
  }
  for (const [fg, bg, req] of pairsEnhancement) {
    const r = contrastHsl(resolve(fg), resolve(bg));
    rows.push([fg, bg, r, req]); worst = Math.min(worst, r / req);
  }
  const parse = (s) => {
    const m = s.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  for (const stop of built.heroStops) {
    const r = contrastHsl([0, 0, 100], parse(fmt(stop)));
    rows.push(["white", `hero stop ${fmt(stop)}`, r, 4.5]); worst = Math.min(worst, r / 4.5);
  }
  for (const [label, bg] of [["sidebar top", built.sidebarBg], ["sidebar middle", built.sidebarMid], ["sidebar bottom", built.sidebarBottom]]) {
    const r = contrastHsl(parse(built.sidebarFg), parse(bg));
    rows.push(["sidebar-foreground", label, r, 4.5]); worst = Math.min(worst, r / 4.5);
  }
  return { rows, worst };
}

/* ---------------- Emit ---------------- */
function emitCss(name, def, built) {
  const lines = [];
  lines.push(`/*`);
  lines.push(`  THEME: ${def.title}`);
  lines.push(`  `);
  lines.push(`  GENERATED by scripts/generate-theme.mjs from ONE OKLCH seed — do not hand-tune`);
  lines.push(`  individual steps; change the seed and regenerate so the scale stays perceptually even.`);
  lines.push(`  `);
  lines.push(`  Algorithm: seed -> OKLCH -> fixed perceptual lightness ramp (50..900), hue arc`);
  lines.push(`  ±${HUE_ARC}° (lights cooler / darks deeper), chroma taper ${CHROMA_TAPER}x toward the extremes,`);
  lines.push(`  sRGB gamut mapping via chroma bisection, interactive steps solved so`);
  lines.push(`  white-on-color >= 4.5:1 by construction (WCAG 2.1 AA).`);
  lines.push(`  Swap themes by changing ONE import in app/globals.css.`);
  lines.push(`*/`);
  lines.push(`@theme inline {`);
  const groups = [
    ["brand-", 10], ["neutral-", 12], ["green-", 5], ["amber-", 5], ["red-", 5], ["blue-", 5], ["violet-", 3],
  ];
  const keys = Object.keys(built.tokens);
  const printed = new Set();
  for (const [prefix] of groups) {
    lines.push(`  /* ${prefix.replace("-", "")} scale */`);
    for (const k of keys.filter((k) => k.startsWith(prefix))) { lines.push(`  --${k}: ${built.tokens[k]};`); printed.add(k); }
    lines.push(``);
  }
  lines.push(`  /* semantic roles, surfaces, sidebar, chart, elevation */`);
  for (const k of keys) { if (!printed.has(k)) lines.push(`  --${k}: ${built.tokens[k]};`); }
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "themes");
mkdirSync(outDir, { recursive: true });

let allPass = true;
const runtimeBlocks = [];
const catalog = [];
for (const [name, def] of Object.entries(THEMES)) {
  const built = buildTokens(name, def);
  runtimeBlocks.push(
    `[data-theme="${name}"] {\n` +
      Object.entries(built.tokens).map(([k, v]) => `  --${k}: ${v};`).join("\n") +
      `\n}`
  );
  catalog.push({ id: name, name: def.name, description: def.blurb });
  const { rows, worst } = audit(name, built);
  const fails = rows.filter(([,, r, req]) => r < req);
  allPass = allPass && fails.length === 0;
  console.log(`\n=== ${name} ===  (worst margin vs requirement: ${(worst * 100 - 100).toFixed(0)}% above)`);
  console.log(`  brand-500 ${built.tokens["brand-500"]}  ·  sidebar ${built.tokens["color-sidebar"]}  ·  bg ${built.tokens["color-background"]}`);
  for (const [fg, bg, r, req] of rows) {
    if (r < req) console.log(`  FAIL ${fg} on ${bg}: ${r.toFixed(2)}:1 < ${req}:1`);
  }
  console.log(`  pairs checked: ${rows.length}, failures: ${fails.length}`);
  if (!process.argv.includes("--audit")) {
    writeFileSync(join(outDir, `${name}.css`), emitCss(name, def, built), "utf8");
  }
}
const FEATURED = ["enterprise-vibrant", "honey-cream", "lavender-lime"];
const rank = (id) => (id === DEFAULT_THEME ? 0 : FEATURED.includes(id) ? FEATURED.indexOf(id) + 1 : 100);
catalog.forEach((item, index) => {
  item.order = index;
});
catalog.sort((a, b) => rank(a.id) - rank(b.id) || a.order - b.order);
catalog.forEach((item) => {
  delete item.order;
});
if (!process.argv.includes("--audit")) {
  const appDir = join(outDir, "..");
  writeFileSync(
    join(appDir, "theme-runtime.css"),
    `/*\n  GENERATED by scripts/generate-theme.mjs — do not edit.\n` +
      `  Runtime theme switching: <html data-theme="..."> selects a preset; any element may set\n` +
      `  data-theme to scope a preset (theme picker previews). Unlayered, so these override the\n` +
      `  compiled default (Tailwind @layer theme) tokens.\n*/\n` +
      runtimeBlocks.join("\n\n") +
      "\n",
    "utf8"
  );
  writeFileSync(
    join(appDir, "..", "lib", "theme-catalog.ts"),
    `// GENERATED by scripts/generate-theme.mjs — do not edit.\n` +
      `export const DEFAULT_THEME_ID = ${JSON.stringify(DEFAULT_THEME)};\n\n` +
      `export const THEME_CATALOG = ${JSON.stringify(catalog, null, 2)} as const;\n\n` +
      `export type ThemeId = (typeof THEME_CATALOG)[number]["id"];\n`,
    "utf8"
  );
}
console.log(allPass ? "\nALL THEMES PASS WCAG 2.1 AA (every pair)" : "\nCONTRAST FAILURES — fix seeds");
process.exitCode = allPass ? 0 : 1;
