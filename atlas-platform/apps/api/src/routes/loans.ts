import { Router } from "express";
import { getDb, sql } from "../db/pool.js";

export const loansRouter = Router();

loansRouter.get("/summary", async (_req, res, next) => {
  try {
    const db = await getDb();
    try {
      const result = await db.request().query("EXEC dbo.sp_ATLAS_GetLoanSummary");
      return res.json(result.recordset[0] || {});
    } catch {
      const fallback = await db.request().query(`
        SELECT
          COUNT(*) AS TotalLoans,
          SUM(CASE WHEN Status = 'Active' THEN 1 ELSE 0 END) AS ActiveLoans,
          SUM(CASE WHEN Status = 'Settled' THEN 1 ELSE 0 END) AS SettledLoans,
          SUM(CASE WHEN Status = 'Deferred' THEN 1 ELSE 0 END) AS DeferredLoans,
          COALESCE(SUM(OriginalAmount), 0) AS TotalOriginal,
          COALESCE(SUM(RemainingBalance), 0) AS TotalOutstanding,
          COALESCE(SUM(EMI), 0) AS MonthlyDeduction,
          COALESCE(SUM(OriginalAmount - RemainingBalance), 0) AS TotalRecovered
        FROM Loans
      `);
      res.json(fallback.recordset[0] || {});
    }
  } catch (err) {
    next(err);
  }
});

loansRouter.get("/active", async (_req, res, next) => {
  try {
    const db = await getDb();
    try {
      const result = await db.request().query("EXEC dbo.sp_ATLAS_GetActiveLoans");
      return res.json(result.recordset || []);
    } catch {
      const fallback = await db.request().query(`
        SELECT l.*, e.EmployeeCode, e.FullName, e.Department
        FROM Loans l
        JOIN Employees e ON e.EmployeeID = l.EmployeeID
        WHERE l.Status = 'Active'
        ORDER BY l.CreatedDate DESC
      `);
      res.json(fallback.recordset || []);
    }
  } catch (err) {
    next(err);
  }
});

loansRouter.get("/register", async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const db = await getDb();
    try {
      const result = await db.request()
        .input("Status", sql.NVarChar(15), status)
        .query("EXEC dbo.sp_ATLAS_GetLoanRegister @Status");
      return res.json(result.recordset || []);
    } catch {
      const fallback = await db.request()
        .input("Status", sql.NVarChar(15), status)
        .query(`
          SELECT l.*, e.EmployeeCode, e.FullName
          FROM Loans l JOIN Employees e ON e.EmployeeID = l.EmployeeID
          WHERE (@Status IS NULL OR l.Status = @Status)
          ORDER BY l.CreatedDate DESC
        `);
      res.json(fallback.recordset || []);
    }
  } catch (err) {
    next(err);
  }
});
