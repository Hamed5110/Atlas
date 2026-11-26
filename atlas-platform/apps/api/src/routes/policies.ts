import { Router } from "express";
import { getDb } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";

export const policiesRouter = Router();

policiesRouter.get("/", requireRole("admin", "manager", "hr"), async (_req, res, next) => {
  try {
    const db = await getDb();
    const result = await db.request().query(`
      SELECT PolicyRateID, MaxPayoutAmount, PerDayRate, CycleDays, EffectiveFrom, EffectiveTo,
             IsActive, PolicyStatus, CreatedAt
      FROM AirfarePolicyRates
      WHERE IsDeleted = 0 OR IsDeleted IS NULL
      ORDER BY EffectiveFrom DESC, PolicyRateID DESC
    `);
    res.json(result.recordset || []);
  } catch (err) {
    next(err);
  }
});
