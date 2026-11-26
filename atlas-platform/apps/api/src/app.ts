import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error.js";
import { loginHandler, authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { employeesRouter } from "./routes/employees.js";
import { openingBalancesRouter } from "./routes/opening-balances.js";
import { allocationsRouter } from "./routes/allocations.js";
import { loansRouter } from "./routes/loans.js";
import { policiesRouter } from "./routes/policies.js";
import { preferencesRouter } from "./routes/preferences.js";

export function createApp() {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"]
      }
    }
  }));
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, max: 5000 }));

  const api = express.Router();
  api.use(healthRouter);
  api.post("/auth/login", loginHandler);

  const protectedApi = express.Router();
  protectedApi.use(authenticate);
  protectedApi.use("/auth", authRouter);
  protectedApi.use("/employees", employeesRouter);
  protectedApi.use("/opening-balances", openingBalancesRouter);
  protectedApi.use("/allocations", allocationsRouter);
  protectedApi.use("/loans", loansRouter);
  protectedApi.use("/airfare-policy-rates", policiesRouter);
  protectedApi.use("/preferences", preferencesRouter);
  api.use(protectedApi);

  app.use("/api", api);

  const frontendDir = config.frontendDir;
  if (fs.existsSync(frontendDir)) {
    app.use(express.static(frontendDir, {
      etag: false,
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-store");
      }
    }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      const indexPath = path.join(frontendDir, "index.html");
      if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
      next();
    });
  } else {
    app.get("/", (_req, res) => {
      res.status(503).send(`<h1>ATLAS Platform API</h1><p>API running on port ${config.port}. Build the web app: <code>npm run build --workspace @atlas/web</code></p>`);
    });
  }

  app.use(errorHandler);
  return app;
}
