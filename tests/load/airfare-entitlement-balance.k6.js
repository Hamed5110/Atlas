import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: Number(__ENV.ATLAS_K6_VUS || 5),
  duration: __ENV.ATLAS_K6_DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"]
  }
};

const baseUrl = (__ENV.ATLAS_LIVE_API_BASE || __ENV.ATLAS_E2E_BASE_URL || "http://127.0.0.1:3389").replace(/\/$/, "") + "/v1";
const token = __ENV.ATLAS_E2E_TOKEN;
const sessionId = __ENV.ATLAS_E2E_SESSION_ID || "k6-airfare-entitlement";
const asOfDate = __ENV.ATLAS_E2E_AS_OF_DATE || "2026-12-31";

export default function () {
  if (!token) {
    throw new Error("Set ATLAS_E2E_TOKEN before running k6 airfare entitlement load test.");
  }
  const response = http.get(`${baseUrl}/airfare/entitlement/balance?asOfDate=${asOfDate}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Session-Id": sessionId
    }
  });
  check(response, {
    "status is 200 or feature-disabled 404": (res) => res.status === 200 || res.status === 404,
    "no server error": (res) => res.status < 500
  });
  sleep(1);
}
