import { Router } from "express";
import { getDb, sql } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";

export const employeesRouter = Router();

employeesRouter.get("/", async (req, res, next) => {
  try {
    const db = await getDb();
    const scope = String(req.query.scope || "active").toLowerCase();
    const statusScope = ["all", "inactive", "ineligible"].includes(scope) ? scope : "active";

    try {
      const result = await db.request()
        .input("StatusScope", sql.NVarChar(20), statusScope)
        .execute("dbo.sp_ATLAS_GetEmployeeMasterForScreen");
      return res.json(result.recordset || []);
    } catch {
      const fallback = await db.request().query(`
        SELECT EmployeeID, EmployeeCode, FullName, Department, Branch, Status,
               OpeningDays, OpeningBHD, MaximumPayout, TotalAirfare, AirfarePaidDays, RemainingBalance
        FROM Employees
        ${statusScope === "all" ? "" : statusScope === "inactive" ? "WHERE Status = 'Inactive'" : "WHERE Status = 'Active'"}
        ORDER BY EmployeeCode
      `);
      res.json(fallback.recordset || []);
    }
  } catch (err) {
    next(err);
  }
});

employeesRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid employee ID" });
    const db = await getDb();
    const result = await db.request()
      .input("EmployeeID", sql.Int, id)
      .query("SELECT * FROM Employees WHERE EmployeeID = @EmployeeID");
    if (!result.recordset.length) return res.status(404).json({ error: "Employee not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    next(err);
  }
});

employeesRouter.post("/", requireRole("admin", "manager", "hr"), async (req, res, next) => {
  try {
    const emp = req.body;
    const db = await getDb();
    const result = await db.request()
      .input("EmployeeCode", sql.NVarChar(20), emp.code)
      .input("FullName", sql.NVarChar(100), emp.name)
      .input("JoinDate", sql.Date, emp.joinDate || null)
      .input("Department", sql.NVarChar(50), emp.department || null)
      .input("Branch", sql.NVarChar(50), emp.branch || null)
      .input("Status", sql.NVarChar(10), emp.status || "Active")
      .input("OpeningDays", sql.Decimal(10, 2), emp.openingDays || 0)
      .input("OpeningBHD", sql.Decimal(10, 2), emp.openingBhd || 0)
      .input("MaximumPayout", sql.Decimal(10, 2), emp.maximumPayout || 150)
      .query(`INSERT INTO Employees (EmployeeCode, FullName, JoinDate, Department, Branch, Status, OpeningDays, OpeningBHD, MaximumPayout)
              OUTPUT INSERTED.*
              VALUES (@EmployeeCode, @FullName, @JoinDate, @Department, @Branch, @Status, @OpeningDays, @OpeningBHD, @MaximumPayout)`);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    next(err);
  }
});
