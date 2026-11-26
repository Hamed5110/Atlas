import assert from "node:assert/strict";
import { test } from "node:test";
import { buildView, parseView, serializeView, shareOf, summableColumns, viewQuery } from "../lib/report-view.ts";

const COLUMNS = ["Employee", "Department", "Year", "Average fare", "Amount", "Trips"];
const ROWS = [
  ["Ali", "Ops", 2026, "200.000", "400.500", 2],
  ["Sara", "Finance", 2026, "150.000", "0", 0],
  ["Omar", "Ops", 2026, "250.000", "250.000", 1],
];
const NUMERIC = new Set([2, 3, 4, 5]);

test("only amount and quantity columns are summed (same cases as the API tests)", () => {
  assert.deepEqual(summableColumns(COLUMNS, NUMERIC), [4, 5]);
});

test("ticket-cost: totals for fund, deduction, net amount, loan and employee cash", () => {
  const cols = [
    "Emp Code",
    "Employee Name",
    "Ticket amount",
    "Total available fund",
    "Payment option",
    "Loan amount",
    "Employee pays (cash)",
    "Company pays",
    "Airfare balance deduction",
    "Net amount",
  ];
  const numeric = new Set([2, 3, 5, 6, 7, 8, 9]);
  const sums = summableColumns(cols, numeric);
  assert.ok(sums.includes(3), "Total available fund");
  assert.ok(sums.includes(5), "Loan amount");
  assert.ok(sums.includes(6), "Employee pays (cash)");
  assert.ok(sums.includes(7), "Company pays");
  assert.ok(sums.includes(8), "Airfare balance deduction");
  assert.ok(sums.includes(9), "Net amount last");
  const { rows } = buildView(
    cols,
    [
      ["0127", "A", "200.000", "67.290", "Make loan", "132.710", "0.000", "0.000", "67.290", "67.290"],
      ["0101", "B", "42.290", "42.290", "Entitlement amount", "0.000", "0.000", "0.000", "42.290", "42.290"],
    ],
    { layout: "standard", group: 0, hideZero: false },
    sums
  );
  const total = rows.find((r) => r.kind === "total");
  assert.ok(total);
  assert.ok(Math.abs(Number(total.cells[3]) - 109.58) < 0.001, "fund total");
  assert.ok(Math.abs(Number(total.cells[5]) - 132.71) < 0.001, "loan total");
  assert.ok(Math.abs(Number(total.cells[6]) - 0) < 0.001, "employee cash total");
  assert.ok(Math.abs(Number(total.cells[8]) - 109.58) < 0.001, "deduction total");
  assert.ok(Math.abs(Number(total.cells[9]) - 109.58) < 0.001, "net amount total");
});

test("grouped layout: headers, sub-totals and a grand total", () => {
  const sums = summableColumns(COLUMNS, NUMERIC);
  const { rows } = buildView(COLUMNS, ROWS, { layout: "grouped", group: 1, hideZero: false }, sums);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["group", "data", "subtotal", "group", "data", "data", "subtotal", "total"]
  );
  assert.equal(rows[0].group, "Finance");
  assert.equal(rows[6].cells[4], 650.5);
  assert.equal(rows.at(-1).cells[5], 3);
});

test("summary layout and hide-zero", () => {
  const sums = summableColumns(COLUMNS, NUMERIC);
  const view = buildView(COLUMNS, ROWS, { layout: "summary", group: 1, hideZero: true }, sums);
  assert.deepEqual(view.columns, ["Department", "Records", "Amount", "Trips"]);
  assert.deepEqual(
    view.rows.map((r) => r.cells),
    [
      ["Ops", 2, 650.5, 3],
      ["Total", 2, 650.5, 3],
    ]
  );
});

test("share layout adds a percent of the total beside each amount", () => {
  const sums = summableColumns(COLUMNS, NUMERIC);
  const view = buildView(COLUMNS, ROWS, { layout: "share", group: 1, hideZero: false }, sums);
  assert.deepEqual(view.columns, ["Department", "Records", "Amount", "Amount %", "Trips", "Trips %"]);
  assert.equal(view.rows[0].cells[0], "Finance");
  assert.equal(view.rows[0].cells[3], 0);
  assert.equal(view.rows[1].cells[3], 100);
  assert.equal(view.rows.at(-1).cells[0], "Total");
  assert.equal(view.rows.at(-1).cells[5], 100);
});

test("ranked layout orders by the first amount and adds a share", () => {
  const sums = summableColumns(COLUMNS, NUMERIC);
  const view = buildView(COLUMNS, ROWS, { layout: "ranked", group: 0, hideZero: false }, sums);
  assert.equal(view.columns[0], "Rank");
  assert.equal(view.columns.at(-1), "Share %");
  assert.deepEqual(
    view.rows.filter((r) => r.kind === "data").map((r) => r.cells[1]),
    ["Ali", "Omar", "Sara"]
  );
  assert.equal(view.rows[0].cells.at(-1), shareOf(400.5, 650.5));
  assert.equal(view.rows.at(-1).cells[0], "Total");
  assert.equal(view.rows.at(-1).cells.at(-1), 100);
});

test("share percent rounds half up, including an exact half", () => {
  assert.equal(shareOf(1, 8), 12.5);
  assert.equal(shareOf(0, 4), 0);
  assert.equal(shareOf(1, 0), "");
});

test("saved layout round-trips and rejects anything else", () => {
  const v = { layout: "grouped", group: 3, hideZero: true };
  assert.equal(serializeView(v), "grouped:3:1");
  assert.deepEqual(parseView("grouped:3:1"), v);
  assert.equal(parseView("pivot:1:0"), null);
  assert.equal(parseView({}), null);
  assert.equal(viewQuery(v), "view_layout=grouped&view_group=3&hide_zero=true");
  assert.equal(viewQuery({ layout: "standard", group: 0, hideZero: false }), "view_layout=standard");
});
