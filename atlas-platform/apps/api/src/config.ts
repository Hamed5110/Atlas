import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, "../.env") });

export const config = {
  port: Number(process.env.PORT || 3360),
  host: process.env.HOST || "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET || "atlas-dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 20),
  lockoutMinutes: Number(process.env.LOCKOUT_MINUTES || 5),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  repoRoot: path.resolve(rootDir, process.env.ATLAS_REPO_ROOT || ".."),
  frontendDir: path.resolve(rootDir, "apps/web/out"),
  version: "3.0.0",
  productCode: "ATLAS_PLATFORM"
};

export const dbConfig = {
  server: process.env.DB_SERVER || "localhost",
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || "Atlasairfare010",
  user: process.env.DB_USER || "sa",
  password: process.env.DB_PASSWORD || "",
  options: {
    encrypt: String(process.env.DB_ENCRYPT || "false").toLowerCase() === "true",
    trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE || "true").toLowerCase() === "true"
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};
