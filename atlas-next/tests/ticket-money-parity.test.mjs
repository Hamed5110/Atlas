import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocationTicketFare,
  drawnAmount,
  settlementKpis,
  ticketAvailableFund,
  ticketPayBreakdown,
} from "../lib/ticket-money.ts";

// Parity with backend `_ticket_cost_pay_breakdown` /
// `_allocation_ticket_fare` / `ticket_drawn_amount` /
// `settle_excess_ticket` (domain/services.py). Settle rules:
//   SELF_PAID_FULL   → draw 0, employee pays the whole fare in cash.
//   COMPANY_PAID     → draw 0, company pays the whole fare.
//   SELF_PAID        → pot drawn, employee pays cash shortfall (fare − pot).
//   CONVERT_TO_LOAN  → pot drawn, employee cash 0, loan = fare − pot.
//   ENTITLEMENT_AMOUNT → pot drawn, company pays the top-up (fare − pot).
// Invariant for every option: net = deduction + company pays.

const bhd3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

const FARE = 120;
const POT = 100;
const GAP = 20; // fare − pot

test("settlement KPI matrix matches backend settle_excess_ticket", () => {
  const cases = [
    // option, deduction (drawn), employee cash, loan, company pays
    ["SELF_PAID", POT, GAP, 0, 0],
    ["CONVERT_TO_LOAN", POT, 0, GAP, 0],
    ["ENTITLEMENT_AMOUNT", POT, 0, 0, GAP],
    ["COMPANY_PAID", 0, 0, 0, FARE],
    ["SELF_PAID_FULL", 0, FARE, 0, 0],
  ];
  for (const [option, deduction, employee, loan, company] of cases) {
    const kpis = settlementKpis(FARE, POT, option);
    assert.equal(kpis.deduction, deduction, `${option} deduction`);
    assert.equal(kpis.employeePays, employee, `${option} employee pays`);
    assert.equal(kpis.loanAmount, loan, `${option} loan`);
    assert.equal(kpis.companyPays, company, `${option} company pays`);
    assert.equal(
      kpis.netAmount,
      bhd3(kpis.deduction + kpis.companyPays),
      `${option}: net = deduction + company pays`,
    );
  }
});

test("COMPANY_PAID / SELF_PAID_FULL draw nothing from the entitlement pot", () => {
  for (const option of ["COMPANY_PAID", "SELF_PAID_FULL"]) {
    const kpis = settlementKpis(FARE, POT, option);
    assert.equal(kpis.deduction, 0, `${option} draws 0`);
    assert.equal(kpis.loanAmount, 0, `${option} no loan`);
  }
});

test("draw-nothing stored rows recover the pot as fare − stored excess marker", () => {
  // Backend: stored entitlement is 0 (no draw); available = fare − marker.
  for (const option of ["COMPANY_PAID", "SELF_PAID_FULL"]) {
    assert.equal(
      ticketAvailableFund({
        ticket_cost: FARE,
        entitlement: 0,
        excess_handling: option,
        excess_amount: 0,
      }),
      FARE,
      `${option}: marker 0 → full fare reconstructed as available fund`,
    );
    // Legacy rows stored the arithmetic gap (fare − pot) in the excess marker.
    assert.equal(
      ticketAvailableFund({
        ticket_cost: FARE,
        entitlement: 0,
        excess_handling: option,
        excess_amount: GAP,
      }),
      POT,
      `${option}: marker = fare − pot → pot recovered`,
    );
  }
});

test("CONVERT_TO_LOAN charges the employee nothing and loans the shortfall", () => {
  const kpis = settlementKpis(FARE, POT, "CONVERT_TO_LOAN");
  assert.equal(kpis.employeePays, 0);
  assert.equal(kpis.companyPays, 0);
  assert.equal(kpis.loanAmount, GAP);
  assert.equal(kpis.excess, GAP); // Settlement "Loan" KPI = fare − pot
});

test("ENTITLEMENT_AMOUNT tops the fare up from the company", () => {
  const kpis = settlementKpis(FARE, POT, "ENTITLEMENT_AMOUNT");
  assert.equal(kpis.companyPays, GAP);
  assert.equal(kpis.employeePays, 0);
  assert.equal(kpis.loanAmount, 0);
  // Net = drawn + top-up = fare (backend comment: matches GL).
  assert.equal(kpis.netAmount, FARE);
});

test("SELF_PAID draws the pot; employee covers the shortfall; net = deduction", () => {
  const kpis = settlementKpis(FARE, POT, "SELF_PAID");
  assert.equal(kpis.deduction, POT);
  assert.equal(kpis.employeePays, GAP);
  assert.equal(kpis.netAmount, kpis.deduction + kpis.companyPays);
  assert.equal(kpis.netAmount, POT);
});

test("unknown / blank option falls back to SELF_PAID (backend default)", () => {
  assert.deepEqual(
    settlementKpis(FARE, POT, ""),
    settlementKpis(FARE, POT, "SELF_PAID"),
  );
  assert.deepEqual(
    settlementKpis(FARE, POT, "LOAN"), // legacy handling token
    settlementKpis(FARE, POT, "SELF_PAID"),
  );
});

test("drawnAmount caps at the pot and draws 0 for draw-nothing options", () => {
  assert.equal(drawnAmount(FARE, POT, "SELF_PAID"), POT);
  assert.equal(drawnAmount(80, POT, "SELF_PAID"), 80);
  assert.equal(drawnAmount(FARE, POT, "CONVERT_TO_LOAN"), POT);
  assert.equal(drawnAmount(FARE, POT, "ENTITLEMENT_AMOUNT"), POT);
  assert.equal(drawnAmount(FARE, POT, "COMPANY_PAID"), 0);
  assert.equal(drawnAmount(FARE, POT, "SELF_PAID_FULL"), 0);
});

test("allocationTicketFare: modern rows read the stored ticket cost", () => {
  assert.equal(allocationTicketFare({ ticket_cost: "150.500" }), 150.5);
});

test("allocationTicketFare: legacy ENTITLEMENT top-up rows reconstruct fare", () => {
  // Legacy rows capped ticket_cost at the drawn pot and kept the request gap
  // as excess (ticket_cost <= drawn).
  const row = {
    ticket_cost: "100.000",
    entitlement: "100.000",
    excess_handling: "ENTITLEMENT_AMOUNT",
    excess_amount: "20.000",
  };
  assert.equal(allocationTicketFare(row), 120);
  // excess_cost takes precedence when both are stored (backend order).
  assert.equal(allocationTicketFare({ ...row, excess_cost: "25.000" }), 125);
  // Modern rows (ticket_cost already the full fare) are not double-counted.
  assert.equal(
    allocationTicketFare({ ...row, ticket_cost: "120.000", entitlement: "100.000" }),
    120,
  );
});

test("ticketPayBreakdown: net = deduction + company pays for stored rows", () => {
  const row = {
    ticket_cost: "120.000",
    entitlement: "100.000",
    excess_handling: "CONVERT_TO_LOAN",
    excess_amount: "20.000",
  };
  const pay = ticketPayBreakdown(row);
  assert.equal(pay.ticketAmount, 120);
  assert.equal(pay.availableFund, 100);
  assert.equal(pay.loanAmount, 20);
  assert.equal(pay.employeePays, 0);
  assert.equal(pay.companyPays, 0);
  assert.equal(pay.deduction, 100);
  assert.equal(pay.netAmount, bhd3(pay.deduction + pay.companyPays));
});

test("ticketPayBreakdown: legacy ENTITLEMENT row keeps the top-up visible", () => {
  const row = {
    ticket_cost: "100.000",
    entitlement: "100.000",
    excess_handling: "ENTITLEMENT_AMOUNT",
    excess_amount: "20.000",
  };
  const pay = ticketPayBreakdown(row);
  assert.equal(pay.ticketAmount, 120);
  assert.equal(pay.companyPays, 20);
  assert.equal(pay.availableFund, 100);
  assert.equal(pay.deduction, 100);
  assert.equal(pay.netAmount, bhd3(pay.deduction + pay.companyPays));
  assert.equal(pay.netAmount, 120); // drawn 100 + top-up 20 = fare
});
