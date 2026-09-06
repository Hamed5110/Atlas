import { Router } from "express";
import { getDb, sql } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";

export const openingBalancesRouter = Router();

openingBalancesRouter.get("/", async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const db = await getDb();
    const result = await db.request()
      .input("Year", sql.Int, year)
      .query(`
        SELECT ob.*, e.EmployeeCode, e.FullName, e.Department, e.Branch, e.MaximumPayout
        FROM OpeningBalances ob
        JOIN Employees e ON e.EmployeeID = ob.EmployeeID
        WHERE ob.BalanceYear = @Year
        ORDER BY e.EmployeeCode
      `);
    res.json(result.recordset || []);
  } catch (err) {
    next(err);
  }
});

openingBalancesRouter.get("/calculate", requireRole("admin", "manager", "hr"), async (req, res, next) => {
  try {
    const openingDays = Math.max(0, Math.min(60, Number(req.query.openingDays || req.query.days || 0)));
    const maximumPayout = Math.max(0, Number(req.query.maximumPayout || 150));
    const openingBhd = Number(((maximumPayout / 60) * openingDays).toFixed(2));
    res.json({ openingDays, maximumPayout, openingBhd, formulaSource: "atlas-platform" });
  } catch (err) {
    next(err);
  }
});
