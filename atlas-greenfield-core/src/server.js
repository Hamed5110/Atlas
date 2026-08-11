import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGreenfieldStore } from "./store/greenfieldStore.js";
import { createMssqlRepository } from "./store/mssqlRepository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const port = Number(process.env.PORT || 3356);
const dataFile = process.env.ATLAS_GREENFIELD_DATA || join(root, "data", "greenfield-store.json");
const repositoryMode = (process.env.ATLAS_GREENFIELD_REPOSITORY || "json").trim().toLowerCase();
const store = await createStore();

const modules = ["companies", "employees", "openingSeeds", "entitlements", "allocations", "loans"];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/") return sendHtml(res, asset("web/index.html"));
    if (req.method === "GET" && url.pathname === "/assets/app.css") return send(res, 200, asset("web/app.css"), "text/css; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/assets/app.js") return send(res, 200, asset("web/app.js"), "application/javascript; charset=utf-8");

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        status: "ok",
        application: "atlas-greenfield-core",
        version: "0.3.0",
        port,
        repository: store.repository || repositoryMode,
        storage: await store.snapshot(),
        dataFile: repositoryMode === "mssql" ? null : dataFile,
        oldRuntimeLinked: false,
        modules,
        schemaContract: "schema/mssql/001_foundation.sql"
      });
    }

    if (req.method === "GET" && url.pathname === "/api/summary") {
      return sendJson(res, 200, await store.moduleSummary({
        tenantId: param(url, "tenantId"),
        companyId: param(url, "companyId"),
        asOfDate: requiredParam(url, "asOfDate")
      }));
    }
    if (req.method === "GET" && url.pathname === "/api/tenants") return sendJson(res, 200, { rows: await store.listTenants() });
    if (req.method === "GET" && url.pathname === "/api/companies") return sendJson(res, 200, { rows: await store.listCompanies(param(url, "tenantId")) });
    if (req.method === "GET" && url.pathname === "/api/employees") {
      return sendJson(res, 200, {
        rows: await store.listEmployees({
          tenantId: param(url, "tenantId"),
          companyId: param(url, "companyId"),
          statusCode: param(url, "statusCode"),
          search: param(url, "search")
        })
      });
    }
    if (req.method === "POST" && url.pathname === "/api/employees") return sendJson(res, 201, { employee: await store.createEmployee(await readJson(req)) });

    if (req.method === "GET" && url.pathname === "/api/opening-seeds") {
      return sendJson(res, 200, { rows: await store.listOpeningSeeds(scopeFromUrl(url)) });
    }
    if (req.method === "POST" && url.pathname === "/api/opening-seeds") return sendJson(res, 201, { seed: await store.createOpeningSeed(await readJson(req)) });

    if (req.method === "GET" && url.pathname === "/api/entitlement/policies") {
      return sendJson(res, 200, { rows: await store.listPolicies(scopeFromUrl(url)) });
    }
    if (req.method === "GET" && url.pathname === "/api/entitlement/balance") {
      return sendJson(res, 200, {
        asOfDate: requiredParam(url, "asOfDate"),
        rows: await store.entitlementBalance({ ...scopeFromUrl(url), asOfDate: requiredParam(url, "asOfDate") })
      });
    }

    if (req.method === "GET" && url.pathname === "/api/allocations") {
      return sendJson(res, 200, { rows: await store.listAllocations(scopeFromUrl(url)) });
    }
    if (req.method === "POST" && url.pathname === "/api/allocations") return sendJson(res, 201, { allocation: await store.createAllocation(await readJson(req)) });

    if (req.method === "GET" && url.pathname === "/api/loans") return sendJson(res, 200, { rows: await store.listLoans(scopeFromUrl(url)) });
    if (req.method === "GET" && url.pathname === "/api/loans/summary") return sendJson(res, 200, await store.loanSummary(scopeFromUrl(url)));
    if (req.method === "POST" && url.pathname === "/api/loans") return sendJson(res, 201, { loan: await store.createLoan(await readJson(req)) });

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
    console.log(`ATLAS greenfield repository: ${store.repository || repositoryMode}`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();

function asset(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

async function createStore() {
  if (repositoryMode === "mssql") {
    return createMssqlRepository();
  }
  const jsonStore = createGreenfieldStore({ dataFile });
  jsonStore.repository = "json-local";
  jsonStore.snapshot = () => ({ repository: "json-local", dataFile });
  return jsonStore;
}

function param(url, name) {
  const value = url.searchParams.get(name);
  return value && value.trim() ? value.trim() : null;
}

function requiredParam(url, name) {
  const value = param(url, name);
  if (!value) {
    const error = new Error(`${name} is required.`);
    error.code = "REQUIRED_QUERY_PARAM";
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function scopeFromUrl(url) {
  return {
    tenantId: param(url, "tenantId"),
    companyId: param(url, "companyId"),
    employeeId: param(url, "employeeId")
  };
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
