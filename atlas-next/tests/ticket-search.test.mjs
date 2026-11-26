import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterTicketsBySearch,
  matchTicketQuery,
  parseTicketQuery,
  removeTicketQueryChip,
  ticketExcess,
  ticketInPolicy,
  ticketQueryChips,
} from "../lib/ticket-search.ts";

const base = {
  id: "abc-123",
  employee_code: "E1042",
  employee_name: "ADEL MOHAMED ABBAS",
  department: "IT",
  designation: "Developer",
  origin_code: "BOM",
  destination_code: "BLR",
  ticket_number: 115,
  ticket_code: "T-000115",
  ticket_cost: "150.000",
  entitlement: "67.500",
  excess_cost: "82.500",
  excess_handling: "SELF_PAID",
  status: "submitted",
  travel_date: "2026-11-24",
};

describe("parseTicketQuery", () => {
  it("splits AND tokens", () => {
    const q = parseTicketQuery("adel bom");
    assert.deepEqual(q.tokens, ["adel", "bom"]);
  });

  it("parses route shorthand", () => {
    assert.deepEqual(parseTicketQuery("BOM→BLR").route, {
      origin: "BOM",
      destination: "BLR",
    });
    assert.deepEqual(parseTicketQuery("bom->blr").route, {
      origin: "BOM",
      destination: "BLR",
    });
    assert.deepEqual(parseTicketQuery("BOM BLR").route, {
      origin: "BOM",
      destination: "BLR",
    });
  });

  it("parses field operators", () => {
    const q = parseTicketQuery("name:adel code:e1042 policy:over");
    assert.equal(q.fields.name, "adel");
    assert.equal(q.fields.code, "e1042");
    assert.equal(q.fields.policy, "over");
  });

  it("parses quoted phrases and commas", () => {
    const q = parseTicketQuery('"adel mohamed", BOM→BLR');
    assert.deepEqual(q.tokens, ["adel mohamed"]);
    assert.deepEqual(q.route, { origin: "BOM", destination: "BLR" });
  });
});

describe("ticketQueryChips", () => {
  it("builds dismissible chips and removes them", () => {
    const raw = "name:adel BOM→BLR";
    const chips = ticketQueryChips(raw);
    assert.ok(chips.some((c) => c.id === "route"));
    assert.ok(chips.some((c) => c.id === "field:name"));
    const withoutRoute = removeTicketQueryChip(raw, chips.find((c) => c.id === "route"));
    assert.equal(withoutRoute.toLowerCase().includes("bom"), false);
    assert.match(withoutRoute, /name:adel/i);
  });
});

describe("matchTicketQuery", () => {
  it("matches name and ticket code", () => {
    assert.equal(matchTicketQuery(base, parseTicketQuery("adel")), true);
    assert.equal(matchTicketQuery(base, parseTicketQuery("T-000115")), true);
    assert.equal(matchTicketQuery(base, parseTicketQuery("#115")), true);
    assert.equal(matchTicketQuery(base, parseTicketQuery("zzz")), false);
  });

  it("requires all tokens (AND)", () => {
    assert.equal(matchTicketQuery(base, parseTicketQuery("adel it")), true);
    assert.equal(matchTicketQuery(base, parseTicketQuery("adel hr")), false);
  });

  it("matches route filters", () => {
    assert.equal(matchTicketQuery(base, parseTicketQuery("BOM→BLR")), true);
    assert.equal(matchTicketQuery(base, parseTicketQuery("DEL→BLR")), false);
  });
});

describe("policy + filterTicketsBySearch", () => {
  const inPolicy = {
    ...base,
    id: "in-1",
    ticket_number: 116,
    ticket_code: "T-000116",
    ticket_cost: "15.000",
    entitlement: "15.000",
    excess_cost: "0",
  };

  it("computes excess / in-policy", () => {
    assert.ok(ticketExcess(base) > 0);
    assert.equal(ticketInPolicy(base), false);
    assert.equal(ticketInPolicy(inPolicy), true);
  });

  it("filters by status and policy lens", () => {
    const rows = [base, inPolicy, { ...base, id: "paid", status: "paid", ticket_number: 90 }];
    const over = filterTicketsBySearch(rows, "", { status: "submitted", policy: "over" });
    assert.equal(over.length, 1);
    assert.equal(over[0].id, "abc-123");

    const ok = filterTicketsBySearch(rows, "policy:in", { status: "submitted" });
    assert.equal(ok.length, 1);
    assert.equal(ok[0].id, "in-1");
  });
});
