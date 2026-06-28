require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const sql = require("mssql");

const config = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true"
  },
  connectionTimeout: 10000,
  requestTimeout: 30000
};

const countSql = `
  SELECT
    (SELECT COUNT(*) FROM Employees) AS Employees,
    (SELECT COUNT(*) FROM Allocations) AS Allocations,
    (SELECT COUNT(*) FROM Loans) AS Loans,
    (SELECT COUNT(*) FROM LoanHistory) AS LoanHistory,
    (SELECT COUNT(*) FROM EmergencyTickets) AS EmergencyTickets,
    (SELECT COUNT(*) FROM OpeningBalances) AS OpeningBalances,
    (SELECT COUNT(*) FROM YearEndHistory) AS YearEndHistory
`;

async function main() {
  const pool = await sql.connect(config);
  const before = await pool.request().query(countSql);

  await pool.request().query(`
    DELETE FROM LoanHistory;
    DELETE FROM Loans;
    DELETE FROM EmergencyTickets;
    DELETE FROM OpeningBalances;
    DELETE FROM YearEndHistory;
    DELETE FROM Allocations;
    DELETE FROM Employees;
  `);

  const after = await pool.request().query(countSql);
  console.log(JSON.stringify({ before: before.recordset[0], after: after.recordset[0] }, null, 2));
  await pool.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
