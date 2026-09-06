import { Router } from "express";
import { config, dbConfig } from "../config.js";
import { getDb } from "../db/pool.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res, next) => {
  try {
    const db = await getDb();
    await db.request().query("SELECT 1 AS ok");
    res.json({
      status: "healthy",
      database: "connected",
      productCode: config.productCode,
      version: config.version,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

healthRouter.get("/version", async (_req, res) => {
  try {
    const db = await getDb();
    await db.request().query("SELECT 1 AS ok");
    res.json({
      product: "ATLAS Platform",
      productCode: config.productCode,
      version: config.version,
      database: { connected: true, name: dbConfig.database },
      runtime: { port: config.port }
    });
  } catch {
    res.json({
      product: "ATLAS Platform",
      productCode: config.productCode,
      version: config.version,
      database: { connected: false, name: dbConfig.database },
      runtime: { port: config.port }
    });
  }
});
