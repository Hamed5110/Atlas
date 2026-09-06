import { Router } from "express";
import { getDb, sql } from "../db/pool.js";

const DEFAULT_PREFERENCES = {
  themeMode: "dark",
  themeAccent: "ocean",
  uiDensity: "comfortable",
  language: "en",
  notifications: "critical"
};

export const preferencesRouter = Router();

preferencesRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const db = await getDb();
    const result = await db.request()
      .input("UserID", sql.Int, userId)
      .query("SELECT TOP 1 PreferencesJson FROM UserPreferences WHERE UserID = @UserID ORDER BY UpdatedAt DESC");
    const row = result.recordset[0];
    if (!row?.PreferencesJson) return res.json(DEFAULT_PREFERENCES);
    try {
      res.json({ ...DEFAULT_PREFERENCES, ...JSON.parse(row.PreferencesJson) });
    } catch {
      res.json(DEFAULT_PREFERENCES);
    }
  } catch {
    res.json(DEFAULT_PREFERENCES);
  }
});

preferencesRouter.put("/", async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const payload = { ...DEFAULT_PREFERENCES, ...(req.body || {}) };
    const db = await getDb();
    await db.request()
      .input("UserID", sql.Int, userId)
      .input("PreferencesJson", sql.NVarChar(sql.MAX), JSON.stringify(payload))
      .query(`
        IF EXISTS (SELECT 1 FROM UserPreferences WHERE UserID = @UserID)
          UPDATE UserPreferences SET PreferencesJson = @PreferencesJson, UpdatedAt = SYSUTCDATETIME() WHERE UserID = @UserID
        ELSE
          INSERT INTO UserPreferences (UserID, PreferencesJson, UpdatedAt) VALUES (@UserID, @PreferencesJson, SYSUTCDATETIME())
      `);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});
