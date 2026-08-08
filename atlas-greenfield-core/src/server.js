import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryStore, defaultSeed } from "./store/memoryStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const store = createMemoryStore(defaultSeed);
const port = Number(process.env.PORT || 3356);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/") {
      return sendHtml(res, readFileSync(join(root, "web", "index.html"), "utf8"));
    }
    if (req.method === "GET" && url.pathname === "/assets/app.css") {
      return send(res, 200, readFileSync(join(root, "web", "app.css"), "utf8"), "text/css; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/assets/app.js") {
      return send(res, 200, readFileSync(join(root, "web", "app.js"), "utf8"), "application/javascript; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        status: "ok",
        application: "atlas-greenfield-core",
        version: "0.1.0",
        port,
        oldRuntimeLinked: false,
        modules: ["employees"],
        schemaContract: "schema/mssql/001_foundation.sql"
      });
    }
    if (req.method === "GET" && url.pathname === "/api/tenants") {
      return sendJson(res, 200, { rows: store.listTenants() });
    }
    if (req.method === "GET" && url.pathname === "/api/companies") {
      return sendJson(res, 200, { rows: store.listCompanies(url.searchParams.get("tenantId")) });
    }
    if (req.method === "GET" && url.pathname === "/api/employees") {
      return sendJson(res, 200, {
        rows: store.listEmployees({
          tenantId: url.searchParams.get("tenantId"),
          companyId: url.searchParams.get("companyId"),
          statusCode: url.searchParams.get("statusCode"),
          search: url.searchParams.get("search")
        })
      });
    }
    if (req.method === "POST" && url.pathname === "/api/employees") {
      const payload = await readJson(req);
      const employee = store.createEmployee(payload);
      return sendJson(res, 201, { employee });
    }
    return sendJson(res, 404, { code: "NOT_FOUND", error: "Route not found." });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      code: error.code || "SERVER_ERROR",
      error: error.message,
      details: error.details || undefined
    });
  }
});

export function start() {
  server.listen(port, "0.0.0.0", () => {
    console.log(`ATLAS greenfield core listening on http://127.0.0.1:${port}`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start();
}

function sendHtml(res, body) {
  send(res, 200, body, "text/html; charset=utf-8");
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body, null, 2), "application/json; charset=utf-8");
}

function send(res, status, body, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Atlas-Greenfield": "true"
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.code = "INVALID_JSON";
    error.statusCode = 400;
    throw error;
  }
}
