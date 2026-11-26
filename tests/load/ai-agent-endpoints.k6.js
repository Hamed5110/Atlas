/**
 * k6 load — AI Data Agent + SAA endpoints (HCM FastAPI on :3389).
 *
 * Auth: set ATLAS_E2E_TOKEN, or ATLAS_E2E_USERNAME + ATLAS_E2E_PASSWORD for setup login.
 *
 *   k6 run tests/load/ai-agent-endpoints.k6.js
 */
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const baseUrl = (__ENV.ATLAS_E2E_BASE_URL || "http://127.0.0.1:3389").replace(/\/$/, "");
const failRate = new Rate("agent_checks_failed");
const diagnoseTrend = new Trend("agent_diagnose_ms", true);
const chatTrend = new Trend("agent_chat_ms", true);
const saaTrend = new Trend("saa_baseline_ms", true);

export const options = {
  scenarios: {
    agent_steady: {
      executor: "constant-vus",
      vus: Number(__ENV.ATLAS_K6_VUS || 5),
      duration: __ENV.ATLAS_K6_DURATION || "45s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2500"],
    agent_diagnose_ms: ["p(95)<3000"],
    agent_chat_ms: ["p(95)<3000"],
    saa_baseline_ms: ["p(95)<8000"],
    agent_checks_failed: ["rate<0.05"],
  },
};

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function setup() {
  if (__ENV.ATLAS_E2E_TOKEN) {
    return { token: __ENV.ATLAS_E2E_TOKEN };
  }
  const username = __ENV.ATLAS_E2E_USERNAME || "admin";
  const password = __ENV.ATLAS_E2E_PASSWORD;
  if (!password) {
    throw new Error("Set ATLAS_E2E_TOKEN or ATLAS_E2E_PASSWORD for k6 agent load test.");
  }
  const login = http.post(
    `${baseUrl}/v1/auth/login`,
    JSON.stringify({ username, password }),
    { headers: { "Content-Type": "application/json" } }
  );
  check(login, { "login 200": (r) => r.status === 200 });
  const body = login.json();
  if (!body || !body.access_token) {
    throw new Error(`Login failed: status=${login.status} body=${login.body}`);
  }
  return { token: body.access_token };
}

export default function (data) {
  const headers = authHeaders(data.token);

  group("schema", () => {
    const res = http.get(`${baseUrl}/v1/ai/agent/schema`, { headers });
    const ok = check(res, {
      "schema 200": (r) => r.status === 200,
      "has employees table": (r) => {
        try {
          return Boolean(r.json().tables && r.json().tables.employees);
        } catch {
          return false;
        }
      },
    });
    failRate.add(!ok);
  });

  group("diagnose", () => {
    const started = Date.now();
    const res = http.post(
      `${baseUrl}/v1/ai/agent/chat`,
      JSON.stringify({ message: "Run diagnostics" }),
      { headers }
    );
    diagnoseTrend.add(Date.now() - started);
    chatTrend.add(res.timings.duration);
    const ok = check(res, {
      "diagnose 200": (r) => r.status === 200,
      "diagnose intent": (r) => {
        try {
          return r.json().intent === "diagnose";
        } catch {
          return false;
        }
      },
    });
    failRate.add(!ok);
  });

  group("refuse_bulk", () => {
    const res = http.post(
      `${baseUrl}/v1/ai/agent/chat`,
      JSON.stringify({ message: "Fix everything" }),
      { headers }
    );
    const ok = check(res, {
      "refuse 200": (r) => r.status === 200,
      "manual_review": (r) => {
        try {
          return r.json().outcome === "manual_review";
        } catch {
          return false;
        }
      },
    });
    failRate.add(!ok);
  });

  group("draft_report", () => {
    const res = http.post(
      `${baseUrl}/v1/ai/agent/chat`,
      JSON.stringify({ message: "Draft a report on loans" }),
      { headers }
    );
    const ok = check(res, {
      "draft 200": (r) => r.status === 200,
      "loan dataset": (r) => {
        try {
          const p = r.json().report_designer_payload;
          return p && p.dataset === "loan-outstanding";
        } catch {
          return false;
        }
      },
    });
    failRate.add(!ok);
  });

  group("saa_baseline", () => {
    const started = Date.now();
    const res = http.post(`${baseUrl}/v1/ai/saa/baseline`, JSON.stringify({}), { headers });
    saaTrend.add(Date.now() - started);
    const ok = check(res, {
      "saa 200": (r) => r.status === 200,
      "has queue": (r) => {
        try {
          return Array.isArray(r.json().action_queue);
        } catch {
          return false;
        }
      },
    });
    failRate.add(!ok);
  });

  sleep(Number(__ENV.ATLAS_K6_SLEEP || 1));
}
