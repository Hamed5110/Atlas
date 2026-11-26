/** Paint-time cache only; the saved choice lives in MSSQL (preferences table). */
export const THEME_CACHE_KEY = "atlas.theme";

/** Inline <head> script: apply the cached theme before first paint (no flash). */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_CACHE_KEY
)});if(t&&/^[a-z0-9-]+$/.test(t))document.documentElement.dataset.theme=t}catch(e){}`;
