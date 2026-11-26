import { Router } from "express";
import { getDb, sql } from "../db/pool.js";

export const allocationsRouter = Router();

allocationsRouter.get("/", async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const db = await getDb();
    const result = await db.request()
      .input("Year", sql.Int, year)
      .query(`
        SELECT a.*, e.EmployeeCode, e.FullName
        FROM Allocations a
        JOIN Employees e ON e.EmployeeID = a.EmployeeID
        WHERE a.AllocYear = @Year
        ORDER BY a.AllocationDate DESC, a.AllocationID DESC
      `);
    res.json(result.recordset || []);
  } catch (err) {
    next(err);
  }
});

allocationsRouter.get("/eligibility-review", async (req, res, next) => {
  try {
    const employeeId = Number(req.query.employeeId);
    const allocYear = Number(req.query.allocYear) || new Date().getFullYear();
    if (!Number.isInteger(employeeId)) return res.status(400).json({ error: "employeeId is required" });

    const db = await getDb();
    const employee = await db.request()
      .input("EmployeeID", sql.Int, employeeId)
      .query("SELECT * FROM Employees WHERE EmployeeID = @EmployeeID");
    const row = employee.recordset[0];
    if (!row) return res.status(404).json({ error: "Employee not found" });

    res.json({
      EmployeeID: row.EmployeeID,
      AllocYear: allocYear,
      OpeningBalanceDays: Number(row.OpeningDays || 0),
      OpeningBalanceAmount: Number(row.OpeningBHD || 0),
      MaximumPayout: Number(row.MaximumPayout || 150),
      EligibleBalanceDays: Number(row.RemainingBalance || row.OpeningDays || 0),
      AirfareEntitlementAmount: Number(row.TotalAirfare || row.OpeningBHD || 0)
    });
  } catch (err) {
    next(err);
  }
});
