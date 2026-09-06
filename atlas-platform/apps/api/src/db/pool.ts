import sql from "mssql";
import { dbConfig } from "../config.js";

let pool: sql.ConnectionPool | null = null;

export async function getDb() {
  if (!pool) {
    pool = await new sql.ConnectionPool(dbConfig).connect();
  }
  return pool;
}

export async function closeDb() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export { sql };
